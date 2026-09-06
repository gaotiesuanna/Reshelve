import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extName__',
  // 商店基本只按名字排，所以 extName 是「品牌词 + 品类词」的长名。但 Chrome 侧栏顶栏和
  // 扩展列表放不下它，会截断成一截没头没尾的字符串——那些窄处读 short_name。
  short_name: '__MSG_extShortName__',
  version: '1.2.1',
  description: '__MSG_extDescription__',
  // 仓库地址。chrome://extensions 的详情页据此显示「访问网站」；商店详情页的
  // Website 链接则以开发者后台「商品详情」里单填的那个为准，两处填成同一个。
  homepage_url: 'https://github.com/gaotiesuanna/Reshelve',
  // favicon：HTML 导出要把图标写进 ICON 属性，靠它读 chrome-extension://<id>/_favicon/
  // （只读 Chrome 本地已缓存的图标，不发外部请求）
  // offscreen：任务后台化之后（docs/specs/background-tasks.md），侧栏关掉时靠一个
  // 不可见文档每 20s 给 service worker 发消息保活，长任务才不因空闲被浏览器回收。
  permissions: ['bookmarks', 'storage', 'unlimitedStorage', 'sidePanel', 'favicon', 'offscreen'],
  // history 只给看板的「访问」排行用，装的时候不要。点「允许读取浏览记录」才申请。
  optional_permissions: ['history'],
  // https 那两条给模型端点用（按用户填的单个域名申请，见 sidepanel/lib/permissions.ts）。
  // http://*/* 是给失效链接检查加的：纯 http 的老书签恰恰是最可能已经死掉的那批，
  // 不声明就只能静默跳过它们，那是最糟的结果。
  // 仍然全是 optional——安装时 Reshelve 一个网络权限都不要，这条没变。
  optional_host_permissions: ['https://*/*', 'http://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  // 图标由 tools/gen-icon.py 生成，源文件在 public/icons/，改配色或形状后重跑该脚本
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_title: '__MSG_extName__',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
})
