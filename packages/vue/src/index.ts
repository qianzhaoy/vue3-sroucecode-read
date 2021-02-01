// This entry is the "full-build" that includes both the runtime
// and the compiler, and supports on-the-fly compilation of the template option.
import { initDev } from './dev'
import { compile, CompilerOptions, CompilerError } from '@vue/compiler-dom'
import { registerRuntimeCompiler, RenderFunction, warn } from '@vue/runtime-dom'
import * as runtimeDom from '@vue/runtime-dom'
import { isString, NOOP, generateCodeFrame, extend } from '@vue/shared'
import { InternalRenderFunction } from 'packages/runtime-core/src/component'

__DEV__ && initDev()

const compileCache: Record<string, RenderFunction> = Object.create(null)

// template 解析
function compileToFunction(
  template: string | HTMLElement,
  options?: CompilerOptions
): RenderFunction {
  // tip: 如果传入的是一个 dom 对象
  if (!isString(template)) {
    if (template.nodeType) {
      // tip: 重写 template 参数为 dom 对象的 innerHTML
      template = template.innerHTML
    } else {
      __DEV__ && warn(`invalid template option: `, template)
      return NOOP
    }
  }

  // tip: 激活缓存
  const key = template
  const cached = compileCache[key]
  if (cached) {
    return cached
  }

  // tip: 传入一个 id 选择器. 也是使用 innerHtml, 可以使用 script template
  if (template[0] === '#') {
    const el = document.querySelector(template)
    if (__DEV__ && !el) {
      warn(`Template element not found or is empty: ${template}`)
    }
    // __UNSAFE__
    // Reason: potential execution of JS expressions in in-DOM template.
    // The user must make sure the in-DOM template is trusted. If it's rendered
    // by the server, the template should not contain any user data.
    template = el ? el.innerHTML : ``
  }

  // tip: 编译模板, 获得 render 函数代码字符串
  const { code } = compile(
    template,
    extend(
      {
        hoistStatic: true,
        onError(err: CompilerError) {
          if (__DEV__) {
            const message = `Template compilation error: ${err.message}`
            const codeFrame =
              err.loc &&
              generateCodeFrame(
                template as string,
                err.loc.start.offset,
                err.loc.end.offset
              )
            warn(codeFrame ? `${message}\n${codeFrame}` : message)
          } else {
            /* istanbul ignore next */
            throw err
          }
        }
      },
      options
    )
  )

  // The wildcard import results in a huge object with every export
  // with keys that cannot be mangled, and can be quite heavy size-wise.
  // In the global build we know `Vue` is available globally so we can avoid
  // the wildcard object.
  // tip: 生成函数
  const render = (__GLOBAL__
    ? new Function(code)()
    : new Function('Vue', code)(runtimeDom)) as RenderFunction

  // mark the function as runtime compiled
  ;(render as InternalRenderFunction)._rc = true

  // tip: 设置缓存并返回 render 函数
  return (compileCache[key] = render)
}

// tip: 注入 compiler 方法到 runtime-core 中
registerRuntimeCompiler(compileToFunction)

export { compileToFunction as compile }

// 划重点: Vue 全局的方法都来自 runtime-dom
export * from '@vue/runtime-dom'
