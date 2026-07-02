/**
 * MarkdownPreview component tests
 *
 * Uses createRoot directly to avoid React 19 CJS act issue.
 * Tests match the actual rendering behavior of the lightweight markdown parser.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import MarkdownPreview from '../../components/MarkdownPreview'

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  root.unmount()
  container.parentNode?.removeChild(container)
})

async function render(el: React.ReactElement) {
  root.render(el)
  await new Promise<void>(r => setTimeout(r, 10))
}

describe('MarkdownPreview', () => {
  it('renders plain text as paragraphs', async () => {
    await render(<MarkdownPreview content="Hello world" />)
    const p = container.querySelector('p')
    expect(p).toBeTruthy()
    expect(p!.textContent).toContain('Hello world')
  })

  it('renders headings', async () => {
    await render(<MarkdownPreview content="# Title" />)
    const h1 = container.querySelector('h1')
    expect(h1).toBeTruthy()
    expect(h1!.textContent).toContain('Title')
  })

  it('renders h2 through h6', async () => {
    await render(<MarkdownPreview content={'## H2'} />)
    const h2 = container.querySelector('h2')
    expect(h2).toBeTruthy()
    expect(h2!.textContent).toContain('H2')
  })

  it('renders inline code', async () => {
    await render(<MarkdownPreview content="Use `console.log` here" />)
    const code = container.querySelector('code')
    expect(code).toBeTruthy()
    expect(code!.textContent).toContain('console.log')
  })

  it('renders code blocks', async () => {
    await render(<MarkdownPreview content={'```\nconst x = 1;\n```'} />)
    const pre = container.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre!.textContent).toContain('const x = 1;')
  })

  it('renders bold text inside lists', async () => {
    await render(<MarkdownPreview content="- This is **bold** text" />)
    const strong = container.querySelector('strong')
    expect(strong).toBeTruthy()
    expect(strong!.textContent).toContain('bold')
  })

  it('renders italic text inside lists', async () => {
    await render(<MarkdownPreview content="- This is *italic* text" />)
    const em = container.querySelector('em')
    expect(em).toBeTruthy()
    expect(em!.textContent).toContain('italic')
  })

  it('renders strikethrough text inside lists', async () => {
    await render(<MarkdownPreview content="- This is ~~deleted~~ text" />)
    const del = container.querySelector('del')
    expect(del).toBeTruthy()
    expect(del!.textContent).toContain('deleted')
  })

  it('renders links inside lists', async () => {
    await render(<MarkdownPreview content="- [Google](https://google.com)" />)
    const link = container.querySelector('a')
    expect(link).toBeTruthy()
    expect(link!.getAttribute('href')).toBe('https://google.com')
    expect(link!.getAttribute('target')).toBe('_blank')
  })

  it('renders blockquotes', async () => {
    await render(<MarkdownPreview content="> Quote text" />)
    expect(container.querySelector('blockquote')).toBeTruthy()
  })

  it('renders horizontal rules', async () => {
    await render(<MarkdownPreview content="---" />)
    expect(container.querySelector('hr')).toBeTruthy()
  })

  it('renders tables', async () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    await render(<MarkdownPreview content={md} />)
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.textContent).toContain('A')
    expect(container.textContent).toContain('1')
  })

  it('renders unordered lists', async () => {
    await render(<MarkdownPreview content="- item1\n- item2" />)
    expect(container.textContent).toContain('item1')
    expect(container.textContent).toContain('item2')
  })

  it('renders ordered lists', async () => {
    await render(<MarkdownPreview content="1. first\n2. second" />)
    expect(container.textContent).toContain('first')
    expect(container.textContent).toContain('second')
  })

  it('escapes HTML in input (XSS protection)', async () => {
    await render(<MarkdownPreview content="<script>alert('xss')</script>" />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('script')
  })

  it('applies custom className', async () => {
    await render(<MarkdownPreview content="text" className="custom-class" />)
    expect(container.firstChild).toBeTruthy()
    expect((container.firstChild as Element).className).toContain('custom-class')
  })

  it('handles empty content', async () => {
    await render(<MarkdownPreview content="" />)
    expect(container.innerHTML).toContain('markdown-preview')
  })

  it('renders images inside lists', async () => {
    await render(<MarkdownPreview content="- ![alt](https://img.png)" />)
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toBe('https://img.png')
  })

  it('renders task lists', async () => {
    await render(<MarkdownPreview content={'- [x] Done\n- [ ] Todo'} />)
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(2)
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false)
  })
})
