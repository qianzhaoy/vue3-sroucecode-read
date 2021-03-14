## 组件实例的字段解释
```javascript
// component.ts function createComponentInstance
  const instance: ComponentInternalInstance = {
    uid: uid++,
    vnode,
    type,
    parent,
    appContext,
    root: null!, // to be immediately set
    next: null,
    // subtree: 执行 render 函数之后返回的 vnode. 所有 render 函数里拿到组件实例, subTree 是 null
    // 划重点: subTree 里的 el.在 render 函数执行完后还没有创建. patch 之后才会有
    subTree: null!, // will be set synchronously right after creation
    // component effect 函数. 依赖收集的对象
    update: null!, // will be set synchronously right after creation
    render: null,
    proxy: null,
    // 调用 expose, 让父组件使用 ref 获取该组件实例的时候, 组件暴露出一个对象来代替自身实例.
    exposed: null,
    // 组件上下文(ctx)的 Proxy 包装对象. 里面有 实例对象 && state && props
    withProxy: null,
    // 这个组件作为依赖被收集的集合. 适用于卸载依赖的场景. 不是通过一个个的 reactive 在 effectStack 里去删除依赖. 就可以通过组件 unmount 的时候. 直接取到 effects. 再去删除依赖集合
    effects: null,
    provides: parent ? parent.provides : Object.create(appContext.provides),
    accessCache: null!,
    renderCache: [],

    // local resovled assets
    components: null,
    directives: null,

    // resolved props and emits options
    propsOptions: normalizePropsOptions(type, appContext),
    emitsOptions: normalizeEmitsOptions(type, appContext),

    // emit
    emit: null as any, // to be set immediately
    emitted: null,

    // state
    ctx: EMPTY_OBJ,
    data: EMPTY_OBJ,
    props: EMPTY_OBJ,
    attrs: EMPTY_OBJ,
    slots: EMPTY_OBJ,
    refs: EMPTY_OBJ,
    setupState: EMPTY_OBJ,
    setupContext: null,

    // suspense related
    suspense,
    suspenseId: suspense ? suspense.pendingId : 0,
    asyncDep: null,
    asyncResolved: false,

    // 组件生命周期的状态
    // lifecycle hooks
    // not using enums here because it results in computed properties
    isMounted: false,
    isUnmounted: false,
    isDeactivated: false,
    // 以下是生命周期
    bc: null,
    c: null,
    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
    rtg: null,
    rtc: null,
    ec: null
  }
```

## vnode 字段
```javascript
const vnode: VNode = {
  __v_isVNode: true,
  [ReactiveFlags.SKIP]: true,
  // type: 组件创建选项. 表面是 type. 其实是 component options. 可以这里理解
  type,
  props,
  key: props && normalizeKey(props),
  ref: props && normalizeRef(props),
  scopeId: currentScopeId,
  // 子元素的 vnode 合集
  children: null,
  // 组件实例
  component: null,
  suspense: null,
  ssContent: null,
  ssFallback: null,
  dirs: null,
  transition: null,
  el: null,
  anchor: null,
  target: null,
  targetAnchor: null,
  staticCount: 0,
  shapeFlag,
  patchFlag,
  dynamicProps,
  dynamicChildren: null,
  appContext: null
}
```