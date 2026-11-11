import { onMounted, type ShallowRef } from 'vue'
import { useRouter } from 'vue-router'

import { isFirstNavigation } from './router'

/**
 * After an in-app navigation, moves focus to the screen heading so keyboard
 * and screen-reader users land on the new content (DESIGN_SYSTEM §8). The
 * first page load keeps the browser's natural focus.
 */
export function useRouteFocus(heading: Readonly<ShallowRef<HTMLElement | null>>) {
  const router = useRouter()

  onMounted(() => {
    if (isFirstNavigation(router)) return
    heading.value?.focus({ preventScroll: true })
  })
}
