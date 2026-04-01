import './globals.css'

export const metadata = {
  title: '外贸背景调查 | Trade Background Intelligence',
  description: '专业外贸背景调查分析系统',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
