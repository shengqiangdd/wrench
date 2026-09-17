/**
 * 拖放上传的「文件夹识别」单测。
 *
 * 背景（原生拖放实测，不是推测）：Chrome 把拖入的**文件夹**当成一个 0 字节 File 交给
 * 页面（`files[0] = {name:'subdir', size:0}`），旧代码于是去 FileReader 读它、失败，
 * 最后弹「读取文件失败: subdir」—— 用户看不懂也没出路。真正的身份在
 * `item.webkitGetAsEntry().isDirectory`。这里把判定逻辑钉住。
 */
import { describe, it, expect } from 'vitest'
import { splitDroppedItems, hasUploadableDrag } from '../../modules/ssh/sftp-utils'

/** 假的 DataTransferItem：只需要 kind + webkitGetAsEntry 两个成员 */
const fileItem = (name: string) => ({
  kind: 'file',
  webkitGetAsEntry: () => ({ isDirectory: false, name }),
})
const dirItem = (name: string) => ({
  kind: 'file',
  webkitGetAsEntry: () => ({ isDirectory: true, name }),
})
const f = (name: string, content = 'x') => new File([content], name)

describe('splitDroppedItems', () => {
  it('普通文件原样通过', () => {
    const files = [f('a.txt'), f('b.txt')]
    const r = splitDroppedItems([fileItem('a.txt'), fileItem('b.txt')], files)
    expect(r.files.map((x) => x.name)).toEqual(['a.txt', 'b.txt'])
    expect(r.dirNames).toEqual([])
    expect(r.hasNonFileItems).toBe(false)
  })

  it('文件夹被挑出来，同名的占位 File 不再当文件传', () => {
    const files = [f('subdir')] // Chrome 给文件夹的「File」就是这个名字
    const r = splitDroppedItems([dirItem('subdir')], files)
    expect(r.files).toEqual([])
    expect(r.dirNames).toEqual(['subdir'])
  })

  it('文件夹 + 文件混拖：文件照传，文件夹单独提示', () => {
    const files = [f('subdir'), f('note.txt')]
    const r = splitDroppedItems([dirItem('subdir'), fileItem('note.txt')], files)
    expect(r.files.map((x) => x.name)).toEqual(['note.txt'])
    expect(r.dirNames).toEqual(['subdir'])
  })

  it('没有 webkitGetAsEntry（Firefox / 合成事件）时不做猜测，全部按文件处理', () => {
    const files = [f('maybe-dir'), f('a.txt')]
    const r = splitDroppedItems([{ kind: 'file' }, { kind: 'file' }], files)
    expect(r.files.map((x) => x.name)).toEqual(['maybe-dir', 'a.txt'])
    expect(r.dirNames).toEqual([])
  })

  it('webkitGetAsEntry 抛异常时按文件处理，不把上传整条路堵死', () => {
    const files = [f('a.txt')]
    const r = splitDroppedItems(
      [
        {
          kind: 'file',
          webkitGetAsEntry: () => {
            throw new Error('SecurityError')
          },
        },
      ],
      files,
    )
    expect(r.files.map((x) => x.name)).toEqual(['a.txt'])
    expect(r.dirNames).toEqual([])
  })

  it('拖进来的是选中的文字/链接：标出 hasNonFileItems', () => {
    const r = splitDroppedItems([{ kind: 'string' }], [])
    expect(r.hasNonFileItems).toBe(true)
    expect(r.files).toEqual([])
  })

  it('items 缺失时退化为「按 files 处理」', () => {
    const files = [f('a.txt')]
    expect(splitDroppedItems(undefined, files).files.map((x) => x.name)).toEqual(['a.txt'])
    expect(splitDroppedItems(null, files).files.map((x) => x.name)).toEqual(['a.txt'])
  })

  it('文件夹名为空串时不制造空提示、也不误删文件', () => {
    const files = [f('a.txt')]
    const r = splitDroppedItems([dirItem('')], files)
    expect(r.dirNames).toEqual([])
    expect(r.files.map((x) => x.name)).toEqual(['a.txt'])
  })
})

describe('hasUploadableDrag', () => {
  it('有文件就是可上传（哪怕 items 为空）', () => {
    expect(hasUploadableDrag(undefined, 1)).toBe(true)
  })

  it('items 里有 file 条目即为可上传', () => {
    expect(hasUploadableDrag([fileItem('a.txt')], 0)).toBe(true)
    // 文件夹也算「有东西可拖」——亮遮罩，松手时再解释为什么不行
    expect(hasUploadableDrag([dirItem('subdir')], 0)).toBe(true)
  })

  it('只有文字/链接时不亮遮罩（以前会亮，松手却什么都没发生）', () => {
    expect(hasUploadableDrag([{ kind: 'string' }], 0)).toBe(false)
    expect(hasUploadableDrag([], 0)).toBe(false)
    expect(hasUploadableDrag(undefined, 0)).toBe(false)
  })
})
