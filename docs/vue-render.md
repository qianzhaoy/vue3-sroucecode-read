```
rentime-dom.ts
  function createApp
  |
  renderer.ts
    function createRenderer(rendererOptions)
      function baseCreateRenderer(): { createApp: createAppApi(render) }
  |
  apiCreateApp.ts
    function createAppApi(render, hydrate?): (rootComponent) => appInstance
    |
    app.mount -> render(vnode, rootContainer)
  |
  renderer.ts
    function processComponent() {}
    function mountComponent() {}
    function render(vnode, container) {} (:2194)
    |
    function patch(container._vnode || null, vnode, container)
    |
    // case: shapeFlag & ShapeFlags.COMPONENT
    |  processComponent()
    |  |
    |  mountComponent() (// 划重点: createInstance)
    |    |
    |    setupComponent() // 划重点: invoke setup, currentInstance = instance; setup() ; currentInstance = null
    |    setupRenderEffect() // set update function and invoke. or Suspense.registerDep(instance, setupRenderEffect)
    |      |
    |      render() // 划重点: invoke component render function to instance.subTree
    |      |
    | -----patch // until real element

    // case: shapeFlag & ShapeFlags.ELEMENT
    |  processElement()
    |  |
    |  mountElement()
    |    |
    |    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
    |      hostSetElementText()
    |    } else {
    |      mountChildren()
    |       |
    |------ patch()
            }
        | hostInsert(el, container, anchor) // anchor 为 insertBefor 的插入锚点
    // ....省略其他 静态节点|文本节点等情况
```
