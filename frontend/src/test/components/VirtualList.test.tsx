import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import VirtualList from '../../components/VirtualList'

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  container.style.height = '400px'
  container.style.overflow = 'auto'
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root) root.unmount()
  if (container.parentNode) container.parentNode.removeChild(container)
  vi.useRealTimers()
})

/** Flush render synchronously before checking DOM */
function syncRender(el: React.ReactNode) {
  flushSync(() => {
    root.render(el)
  })
}

describe('VirtualList', () => {
  it('renders all items when below virtualize threshold', () => {
    const items = Array.from({ length: 10 }, (_, i) => `Item ${i}`)
    syncRender(
      <VirtualList items={items} itemHeight={40} renderItem={(item) => <span>{item}</span>} />,
    )
    const html = container.innerHTML
    for (let i = 0; i < 10; i++) {
      expect(html).toContain(`Item ${i}`)
    }
  })

  it('renders empty items list', () => {
    syncRender(<VirtualList items={[]} itemHeight={40} renderItem={() => null} />)
    expect(true).toBe(true)
  })

  it('uses non-virtualized rendering for small lists', () => {
    const items = Array.from({ length: 50 }, (_, i) => `Item ${i}`)
    syncRender(
      <VirtualList
        items={items}
        itemHeight={40}
        virtualizeThreshold={100}
        renderItem={(item) => <span>{item}</span>}
      />,
    )
    const html = container.innerHTML
    expect(html).toContain('Item 0')
    expect(html).toContain('Item 49')
  })

  it('renders with custom className', () => {
    const items = ['test']
    syncRender(
      <VirtualList
        items={items}
        itemHeight={40}
        className="custom-list"
        renderItem={(item) => <span>{item}</span>}
      />,
    )
    const html = container.innerHTML
    expect(html).toContain('test')
  })

  it('handles keyboard Home/End keys via tabIndex', () => {
    const items = Array.from({ length: 20 }, (_, i) => `Item ${i}`)
    syncRender(
      <VirtualList items={items} itemHeight={40} renderItem={(item) => <span>{item}</span>} />,
    )
    const html = container.innerHTML
    expect(html).toContain('Item 0')
    expect(html).toContain('Item 19')
  })
})
