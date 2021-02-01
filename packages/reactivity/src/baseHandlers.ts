import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap
} from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend
} from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations: Record<string, Function> = {}
// instrument identity-sensitive Array methods to account for possible reactive
// values
;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
  const method = Array.prototype[key] as any
  arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
    // tip: this 指向 proxy, 通过 receiver Reflect.get(arrayInstrumentations, key, receiver)
    const arr = toRaw(this)
    for (let i = 0, l = this.length; i < l; i++) {
      track(arr, TrackOpTypes.GET, i + '')
    }
    // we run the method using the original args first (which may be reactive)
    // tip: 支持参数是 reactive(target) 的时候, 也能查到 target 在 reactive([target]) 数组里的结果
    // tip: 先跑一遍源参数. 如果 args 是 reactive 数据的话会查不到
    // 比如: 
    // const obja = {a: 1}
    // const observedB = Vue.reactive(obja)
    // const observeA = Vue.reactive([1,2,3, obja])
    // const index = observeA.indexOf(observedB)
    // console.log(index) // 3
    const res = method.apply(arr, args)
    if (res === -1 || res === false) {
      // tip: 如果查不到, 就 args toRaw 再跑一遍
      // if that didn't work, run it again using raw values.
      return method.apply(arr, args.map(toRaw))
    } else {
      return res
    }
  }
})
// instrument length-altering mutation methods to avoid length being tracked
// which leads to infinite loops in some cases (#2137)
;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
  const method = Array.prototype[key] as any
  arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
    pauseTracking()
    // tip: 只需要简单的调用执行, 执行完后, 数组数据改变后, 会触发 proxy 的 setter. 调用 effect 更新视图
    const res = method.apply(this, args)
    resetTracking()
    return res
  }
})

function createGetter(isReadonly = false, shallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) {
    // tip: get 拦截. 这里是用来判断 observed 的一些额外属性. 而不是 set 到 proxy 的属性上
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (
      key === ReactiveFlags.RAW &&
      receiver === (isReadonly ? readonlyMap : reactiveMap).get(target)
    ) {
      return target
    }

    const targetIsArray = isArray(target)
    // tip: array 操作数组的方法拦截
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }

    const res = Reflect.get(target, key, receiver)

    if (
      isSymbol(key)
        ? builtInSymbols.has(key as symbol)
        : key === `__proto__` || key === `__v_isRef`
    ) {
      return res
    }

    if (!isReadonly) {
      // tip: getter track, 数据依赖收集
      track(target, TrackOpTypes.GET, key)
    }

    if (shallow) {
      return res
    }

    if (isRef(res)) {
      // ref unwrapping - does not apply for Array + integer key.
      // tip: 如果出现 reactive<ref[]> 不生效
      // 例如: 
      // template: '<div>{{observeA[0]}}</div>', 
      // setup() {
      //   const refa = Vue.ref(1)
      //   const observeA = Vue.reactive([refa])
      //   return {
      //     observeA,
      //   }
      // }
      // 期望: <div>1</div>
      // 实际: <div>{ "_rawValue": 1, "_shallow": false, "__v_isRef": true, "_value": 1 }</div>
      // 正确使用: template: '<div>{{observeA[0].value}}</div>', 
      const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
      // 划重点: 事实上 return res.value 上述案例也是可行的. 但是不知道为什么不这么做. 不太相信是 bug
      return shouldUnwrap ? res.value : res
    }

    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      // tip: 如果结果是一个对象, 就 reactive 代理它. 作用大概类似可以做到只收集用到的依赖. 同时不需要无脑递归所有的对象. 提高性能
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    const oldValue = (target as any)[key]
    if (!shallow) {
      // tip: 先 toRaw, 如果 new value 是一个 reactive 的 proxy 对象的话.
      value = toRaw(value)
      /**
        * 例如: 
        {
          template: '<div>{{refa}}{{observeA.a}}</div>',
          setup() {
            const refa = Vue.ref(1)
            const observeA = Vue.reactive({a: refa})
            setTimeout(() => {
              // bad not work
              observeA.a.value = 3
              // good is work
              observeA.a = 3
              refa.value = 3
            }, 2000);
            return {
              observeA,
              refa
            }
          }
        }
    */
      // tip: target 非数组. 嵌套 ref 对象, 直接复写 ref 对象的 value 值
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    // tip: 这个 key 在 target 内是否存在
    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    // tip: Reflect 提供一些通用的静态工具方法可以操作 target. 类似 loadsh, 这里可以简单的当做 _.set.
    // tip: receiver 相当于 Reflect.set.apply(receiver).如果 target[key] 是一个 setter 的话, 改变 set 函数的 this 指向. 
    // tip: 因为这个 set 函数是 proxy 的 handler, 所以 receiver 就是这个 target proxy 自身
    const result: boolean = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    // tip: 数据依赖更新触发. 只触发自身属性. 这里涉及到对象的原型是一个 proxy 对象的场景
    // tip: 如果目标的原型对象也是一个 proxy, 通过 Reflect.set 修改原型链上的属性会再次触发 setter, 这种情况下不触发 trigger
    // 参考 https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/set
    // https://stackoverflow.com/questions/37563495/what-is-a-receiver-in-javascript
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        // 添加新属性
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        // 更新属性
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

export const shallowReactiveHandlers: ProxyHandler<object> = extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers: ProxyHandler<object> = extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
