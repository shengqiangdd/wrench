// 哈希生成器插件
(function () {
  const api = SmartBox.getPluginAPI()

  /** 使用 Web Crypto API 计算哈希 */
  async function computeHash(algorithm, text) {
    const encoder = new TextEncoder()
    const data = encoder.encode(text)
    const hashBuffer = await crypto.subtle.digest(algorithm, data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /** MD5 实现（纯 JS，因为 Web Crypto 不支持 MD5） */
  function md5(text) {
    // 标准 MD5 实现
    function md5cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3]
      // FF 轮
      a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586)
      c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330)
      a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426)
      c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983)
      a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417)
      c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162)
      a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101)
      c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329)
      // GG 轮
      a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632)
      c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302)
      a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083)
      c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848)
      a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690)
      c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501)
      a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784)
      c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734)
      // HH 轮
      a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463)
      c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556)
      a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353)
      c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640)
      a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222)
      c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189)
      a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835)
      c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651)
      // II 轮
      a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415)
      c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055)
      a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606)
      c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799)
      a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744)
      c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649)
      a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379)
      c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551)

      x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3])
    }

    function cmn(q, a, b, x, s, t) { return add32(rol32(add32(add32(a, q), add32(x, t)), s), b) }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t) }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t) }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t) }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t) }

    function rol32(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)) }
    function add32(a, b) { return (a + b) & 0xFFFFFFFF }
    function str2binl(str) {
      const bin = []
      for (let i = 0; i < str.length * 8; i += 8) {
        bin[i >> 5] |= (str.charCodeAt(i / 8) & 0xFF) << (i % 32)
      }
      return bin
    }
    function binl2hex(bin) {
      const hex = '0123456789abcdef'
      let str = ''
      for (let i = 0; i < bin.length * 4; i++) {
        str += hex.charAt((bin[i >> 2] >> ((i % 4) * 8 + 4)) & 0xF) + hex.charAt((bin[i >> 2] >> ((i % 4) * 8)) & 0xF)
      }
      return str
    }

    const bin = str2binl(unescape(encodeURIComponent(text)))
    const len = bin.length
    bin[len] = 0x80
    bin[len + 1] = 0
    const originalLen = text.length * 8
    while (bin.length < 16) bin.push(0)
    bin[14] = originalLen & 0xFFFFFFFF
    bin[15] = (originalLen >>> 32) & 0xFFFFFFFF

    let h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476]
    for (let i = 0; i < bin.length; i += 16) {
      const block = bin.slice(i, i + 16)
      const hh = h.slice()
      md5cycle(hh, block)
      h = h.map((v, idx) => add32(v, hh[idx]))
    }

    return binl2hex(h)
  }

  function formatHashResult(text, algorithm, hash) {
    const preview = text.length > 50 ? text.slice(0, 50) + '...' : text
    return [
      `算法: ${algorithm}`,
      `输入: ${preview}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `${hash}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `字节数: ${new TextEncoder().encode(text).length}`,
      `字符数: ${text.length}`,
    ].join('\n')
  }

  function formatAllHashes(text, hashes) {
    const preview = text.length > 50 ? text.slice(0, 50) + '...' : text
    const lines = [`输入: ${preview}`, `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`]
    for (const [name, hash] of Object.entries(hashes)) {
      lines.push(`${name.padEnd(12)} ${hash}`)
    }
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    lines.push(`字节数: ${new TextEncoder().encode(text).length}`)
    return lines.join('\n')
  }

  function computeAll(text) {
    return {
      MD5: md5(text),
      'SHA-1': md5(text), // placeholder, real SHA-1 via async
      'SHA-256': md5(text),
      'SHA-512': md5(text),
    }
  }

  async function getHash(text, algo, label) {
    if (algo === 'MD5') {
      return { label, hash: md5(text) }
    }
    const hash = await computeHash(algo, text)
    return { label, hash }
  }

  api.registerCommand('hash-md5', {
    label: 'MD5 哈希',
    description: '计算当前内容的 MD5 哈希值',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入文本', 'warning'); return }
      const hash = md5(content)
      api.setEditorContent(formatHashResult(content, 'MD5', hash))
      api.showNotification('MD5 计算完成', 'success')
    }
  })

  api.registerCommand('hash-sha1', {
    label: 'SHA-1 哈希',
    description: '计算当前内容的 SHA-1 哈希值',
    execute: async () => {
      const content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入文本', 'warning'); return }
      try {
        const hash = await computeHash('SHA-1', content)
        api.setEditorContent(formatHashResult(content, 'SHA-1', hash))
        api.showNotification('SHA-1 计算完成', 'success')
      } catch (e) {
        api.showNotification('SHA-1 计算失败: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('hash-sha256', {
    label: 'SHA-256 哈希',
    description: '计算当前内容的 SHA-256 哈希值',
    execute: async () => {
      const content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入文本', 'warning'); return }
      try {
        const hash = await computeHash('SHA-256', content)
        api.setEditorContent(formatHashResult(content, 'SHA-256', hash))
        api.showNotification('SHA-256 计算完成', 'success')
      } catch (e) {
        api.showNotification('SHA-256 计算失败: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('hash-sha512', {
    label: 'SHA-512 哈希',
    description: '计算当前内容的 SHA-512 哈希值',
    execute: async () => {
      const content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入文本', 'warning'); return }
      try {
        const hash = await computeHash('SHA-512', content)
        api.setEditorContent(formatHashResult(content, 'SHA-512', hash))
        api.showNotification('SHA-512 计算完成', 'success')
      } catch (e) {
        api.showNotification('SHA-512 计算失败: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('hash-all', {
    label: '所有哈希',
    description: '一次性计算 MD5 / SHA-1 / SHA-256 / SHA-512',
    execute: async () => {
      const content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入文本', 'warning'); return }
      try {
        const [sha1, sha256, sha512] = await Promise.all([
          computeHash('SHA-1', content),
          computeHash('SHA-256', content),
          computeHash('SHA-512', content),
        ])
        const result = formatAllHashes(content, {
          'MD5': md5(content),
          'SHA-1': sha1,
          'SHA-256': sha256,
          'SHA-512': sha512,
        })
        api.setEditorContent(result)
        api.showNotification('所有哈希计算完成', 'success')
      } catch (e) {
        api.showNotification('哈希计算失败: ' + e.message, 'error')
      }
    }
  })

  console.log('[插件] 哈希生成器已加载')
})()
