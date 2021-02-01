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