export type LocalAgentPlatform = 'android' | 'ios' | 'desktop'

/** Identifies platforms where the current native local SSH Agent can or cannot run. */
export function getLocalAgentPlatform(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
): LocalAgentPlatform {
  if (/android/i.test(userAgent)) return 'android'
  // iPadOS can request the desktop Safari user agent while still identifying as a touch device.
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return 'ios'
  }
  return 'desktop'
}

export function getLocalAgentUnavailableMessage(platform: LocalAgentPlatform): string {
  if (platform === 'ios') {
    return 'iPhone/iPad 当前无法运行本机 Agent。请明确改选 Wrench 服务端模式，并确认服务端可达目标。'
  }
  if (platform === 'android') {
    return 'Android Agent 尚无下载包且未完成真机验证。若你已自行运行兼容 Agent，请先在本机终端配对；不会自动切换到服务端。'
  }
  return '本机 Agent 未配对；请在运行 Agent 的同一台设备上到设置中完成配对'
}
