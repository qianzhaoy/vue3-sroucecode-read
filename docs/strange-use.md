### reactive 嵌套 ref 的场景
```javascript
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
// 源码位置: baseHandler:139. 对数组的 reactive 对象不生效. 参考下个例子
```


### Reactive 数组嵌套 ref 的情况
```javascript
{
  template: '<div>{{observeA[0]}}</div>', 
  setup() {
    const refa: RefImpl = Vue.ref(1)
    const observeA: Reactive<RefImpl[]> = Vue.reactive([refa])
    return {
      observeA,
    }
  }
}
// 期望输出: 
// <div>1</div>

// 实际输出: 
// <div>{ "_rawValue": 1, "_shallow": false, "__v_isRef": true, "_value": 1 }</div>

// 正确使用: 
// template: '<div>{{observeA[0].value}}</div>', 

// 原因: baseHandlers.ts:112
// 如果源码这行改成 return res.value. 案例就能得到期望值. 但是明显作者不想这么做. 暂时还不知道为什么
```

### Reactive 数组嵌套 ref 的情况 2
```javascript
{
  template: '<div>{{observeA[0].value}}</div>', 
  setup() {
    const refa: RefImpl = Vue.ref(1)
    const observeA: Reactive<RefImpl[]> = Vue.reactive([refa])
    setTimeout(() => {
      // bad not word
      observeA[0] = 2
      // good work
      observeA[0].value = 2
    }, 2000);
    return {
      observeA,
    }
  }
}

```
### vue 数组查询的优化
```javascript
const obja = {a: 1}
const observedA = Vue.reactive(obja)
const observeB = Vue.reactive([1,2,3, obja])
// 通过寻找 observedA, 仍旧可以找到 obja 在 observeB 内的下标
// 因为 vue 拦截了数组的方法. 调用了两遍 indexOf. proxy 对象和源对象各查一遍
// includes 和 findIndex 同理
const index = observeB.indexOf(observedA)
console.log(index) // 3
```

### createApp 的 template 可以改到别的地方 (并没有什么卵用 )
```html
<div id="app">
  <custom-a></custom-a>
</div>
```
```javascript
const app = Vue.createApp({
  data() {
    return {
      count: 10
    }
  }
})

app.mount("#app")
```

### render 函数参数的意义
```javascript
render!.call(
  proxyToUse,
  proxyToUse!, // 经过 Proxy 包装的组件上下文, 里面有 props && state && 实例 api && 插件全局属性 === this
  renderCache, // render 函数缓存. 但是没看到哪里做了缓存
  props,
  setupState, // state
  data, 
  ctx // 上下文. 看起来是没被 proxy 包装的 this
)
const proxyToUse = withProxy || proxy
instance.withProxy = new Proxy(
  instance.ctx,
  RuntimeCompiledPublicInstanceProxyHandlers
)

// example
{
  render(proxyToUse) {
    proxyToUse === this // true
    return <div></div>
  }
}
```


### expose 函数

组件暴露出的对象

> 用法
```javascript
// comp-a.vue
{
  name: 'comp-a',
  setup(props, { attrs, slots, emit, expose }) {
    function getOffsetTop() {
      // do something
      return result
    }
    const observed = reactive({
      a: 1
    })
    // 用法
    expose({
      getOffsetTop
    })
    return {
      observed,
      getOffsetTop
    }
  }
}
// comp-b.vue
{
  template: `
    <comp-a ref="compa" />
  `,
  setup() {
    const compa = ref(null)
    onMounted(() => {
      // 用了 comp-a 调用 expose 之后, ref 拿到的结果为 expose 的参数
      compa.value // { getOffsetTop }
      // 正常情况, comp-a 不调用 expose
      // compa.value // coma-a instance (comp-a 的组件实例)
    })
    return {
      compa
    }
  }
}
```

> 源码解析
```javascript
// renderer.ts
const setRef = (
  rawRef: VNodeNormalizedRef,
  oldRawRef: VNodeNormalizedRef | null,
  parentComponent: ComponentInternalInstance,
  parentSuspense: SuspenseBoundary | null,
  vnode: VNode | null
) => {
  // ...
  let value: ComponentPublicInstance | RendererNode | Record<string, any> | null
    if (!vnode) {
      value = null
    } else {
      if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
        // ref value，Proxy<instance.exposed> 或者 Proxy( proxy<componentInstance> )
        value = vnode.component!.exposed || vnode.component!.proxy
      } else {
        value = vnode.el
      }
    }
  // ...
}
```