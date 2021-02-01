import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, isArray, isIntegerKey, isMap } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true
  id: number
  active: boolean
  raw: () => T
  deps: Array<Dep>
  options: ReactiveEffectOptions
  allowRecurse: boolean
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  scheduler?: (job: ReactiveEffect) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
  allowRecurse?: boolean
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

const effectStack: ReactiveEffect[] = []

// 划重点: 组件实例化前, 会调用 effect 给组件创建 update 函数
// 划重点: instance.update = effect(function componentEffect() {}. ( renderer: 1356 )
// 划重点: 让组件在 setup 函数执行过程中, 将 activeEffect 赋值成 component.update 函数. 
// 划重点: 这样setup 里面的 hooks 就能隐性的指向这个 component. 而不需要绑定 this(解惑: 一直在疑惑为什么 hooks 能不需要绑定 this)
// 划重点: 所以 hooks 里面的 reactive watch 等等 api. 依赖收集的时候, 也能收集到 hooks 调用的当前组件的 update 函数作为依赖
let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

export function isEffect(fn: any): fn is ReactiveEffect {
  return fn && fn._isEffect === true
}

export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

let uid = 0
function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(): unknown {
    if (!effect.active) {
      return options.scheduler ? undefined : fn()
    }
    if (!effectStack.includes(effect)) {
      cleanup(effect)
      try {
        // 开启追踪
        enableTracking()
        // effect 推入 effect 栈中
        effectStack.push(effect)
        // 设置当前激活的 effect
        activeEffect = effect
        // 调用副作用函数
        return fn()
      } finally {
        // 虽然 try 里面 return 了, 但是 finally 还是会执行
        // 推出 effect. 
        effectStack.pop()
        resetTracking()
        // 划重点: 设置当前激活的 effect 为上一个调用栈;
        // 举个例子: 
        /**
         * 组件创建时, effectStack 添加第一个 effect 调用栈, 此时 activeEffect 为 component update 函数,
         * setup 执行到 reactive 的时候, 能收集到 component update 函数作为依赖;
         * 执行到 computed 的时候, 会插进来一个新的 effect 调用栈, 此时 activeEffect 为 computed getter  具体看 computed.ts 的源码.
         * 那么 effectStack = [componentUpdate, computedGetter]; activeEffect = computedGetter
         * 然后 getter 里面的的 observeA 获取 activeEffect 依赖的时候就是 computedGetter;
         * 然后 computed 执行结束, getter 推出 effectStack, 重置 activeEffect 为 componentUpdate
         */
        /** 
         * setup() {
         *  const observeA = reactive({a: 1})
         *  computed(function() {
         *    return observeA + 1
         *  })
         *  return {}
         * }
        */
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  effect.id = uid++
  effect.allowRecurse = !!options.allowRecurse
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  // computedEffect.deps = Array<Set<ReactiveEffect, computedEffect>>
  // 删除
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

// tip: 数据追踪, 依赖收集
export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    return
  }
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }
  // tip: dep 是 target 依赖的集合
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }
  // 首次渲染后，组件将跟踪一组依赖列表——即在渲染过程中被访问的 property。
  // 反过来，组件就成为了其每个 property 的订阅者。
  // 当 Proxy 拦截到 set 操作时，该 property 将通知其所有订阅的组件重新渲染。
  if (!dep.has(activeEffect)) {
    // tip: 设置数据更新的副作用函数. 依赖收集完毕
    // 例如: target 更新, 会触发调用 activeEffect, 就可以更新视图
    dep.add(activeEffect)
    // tip: 这里又把 dep push 到 activeEffect.deps. 作为副作用函数的依赖集合
    // 在组件的 setup 里调用 reactive. reactive 的 observer 的 deps 是这个 component 的 update effect
    // cleanup 只要取 componentEffect 的 deps. 就可以卸载与自己有关全部依赖, 释放内存
    // 划重点:
    /** 
     * const observe = reactive({a:1, b: 1, c: 1})
     * computed(function() { return observe.a + observe.b + 1 })
     *  
     * const depa = Set<componentEffect, computedEffect>
     * const depb = Set<componentEffect, computedEffect>
     * const depc = Set<componentEffect>
     * Map{
     *  [{a:1, b:1, c: 1}]: Map{
     *    a: depa,
     *    b: depb,
     *    c: depc,
     *  }
     * }
     * 
     * componentEffect.deps = [<componentEffect>, <componentEffect>, <componentEffect>]
     * computedEffect.deps = [depa, depb]
     * 
     * 组件卸载的时候, 先卸载 computed watch 等的 effect, 再卸载 reactive 的 effect
     * cleanup 的逻辑, cleanup(computedEffect) -> forEach(computedEffect.deps.delete(computedEffect)) -> computedEffect.deps.length = 0
     * 执行完后 depa 和 depb 中就没有 computedEffect 了. 之后执行 ummont, 继续释放所有依赖中 componentEffect 函数
     */
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    return
  }

  const effects = new Set<ReactiveEffect>()
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        if (effect !== activeEffect || effect.allowRecurse) {
          effects.add(effect)
        }
      })
    }
  }

  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        add(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      add(depsMap.get(key))
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    switch (type) {
      case TriggerOpTypes.ADD:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // new index added to array -> length changes
          add(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          add(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  // tip: effect 是依赖收集后, 执行 effect 函数能触发更新.
  const run = (effect: ReactiveEffect) => {
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    // tip: 任务调度 effect. 简单来说是对 effect 的一层抽象. 用来接管 effect. 而不是直接调用 effect
    if (effect.options.scheduler) {
      effect.options.scheduler(effect)
    } else {
      effect()
    }
  }

  effects.forEach(run)
}
