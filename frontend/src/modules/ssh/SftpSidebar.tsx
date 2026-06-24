/**
 * SftpSidebar.tsx — SSH 页面右侧面板的 SFTP 文件浏览器
 *
 * 基于通用的 SftpBrowser 组件，添加到右面板中。
 * 双击文件 → 弹出模态框查看/编辑
 */

import SftpBrowser from './SftpBrowser'

interface Props {
  sessionId: string
}

export default function SftpSidebar({ sessionId }: Props) {
  return (
    <SftpBrowser
      sessionId={sessionId}
    />
  )
}
