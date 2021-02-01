import {
  computed as _computed,
  ComputedRef,
  WritableComputedOptions,
  WritableComputedRef,
  ComputedGetter
} from '@vue/reactivity'
import { recordInstanceBoundEffect } from './component'

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
// tip: computed API 真正调用的地方, 重命名 computed 函数, 用来记录这个 computed api 在哪个组件实例内调用
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  const c = _computed(getterOrOptions as any)
  recordInstanceBoundEffect(c.effect)
  return c
}
