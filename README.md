# 爱听写词汇标注

一个浏览器扩展，可以在任意英文网页中自动标注词汇表中的单词，并提供已掌握词管理、生词本和自定义词表导入功能。

最初为 [爱听写](https://www.idictation.cn/) 的雅思阅读场景开发，后解除了站点限制——BBC、经济学人、Wikipedia、Reddit 等任意英文网页都能用。

## 功能

- **自动标注**：扫描页面文本，把词汇表里的单词以选定的样式标出来，鼠标悬停显示释义
- **14 种标注样式**：整块高亮、下划线、波浪线、荧光笔、虚线/实线方框等，可在设置中切换
- **颜色自定义**：3 种预设色块（黄 / 青 / 粉）+ 自由调色
- **3 个内置词表**：高中词汇、大学英语四级、大学英语六级
- **自定义词表导入**：支持 TXT / CSV / TSV / JSON / XLSX 五种格式，拖拽或点击即可
- **已掌握词管理**：`Alt/Option` + 点击标注词即可标为已掌握，不再出现
- **生词本**：鼠标悬停英文词，按 `Alt/Option + N` 加入生词本；自动调用有道词典查释义；一键导出 Markdown，方便粘贴到 Anki / Notion / Obsidian
- **快捷键自定义**：所有快捷键可在设置页修改（修饰键 + 单字符）
- **简单词形还原**：自动识别 `-s / -es / -ed / -ing / -ies / -ied` 等常见后缀变化，匹配更准确
- **SPA 兼容**：通过 `MutationObserver` 处理异步加载的内容

## 安装

目前通过 Chrome 开发者模式加载：

1. 下载本仓库或 `git clone`
2. 打开 Chrome / Edge，访问 `chrome://extensions`
3. 右上角打开"开发者模式"
4. 点击"加载已解压的扩展程序"，选择仓库中的 `extension/` 目录
5. 在任意英文网页刷新一次即可看到标注

## 使用

### 默认快捷键

| 操作 | 快捷键 |
|---|---|
| 标记为已掌握 | `Alt/Option` + 点击标注词 |
| 加入生词本 | 鼠标悬停英文词，按 `Alt/Option + N` |

两组快捷键都可在设置页自定义。

### 设置页

浏览器工具栏点击扩展图标 → "打开设置"；或在 `chrome://extensions` 中找到扩展 → "扩展程序选项"。

设置项：

- 启用 / 禁用标注
- 切换词汇表（单选，内置 + 自定义）
- 选择标注样式与颜色（带实时预览）
- 自定义快捷键
- 清空已掌握词
- 导出 / 清空生词本

### 导入自定义词表

设置页 → 词汇表 → 点击或拖拽文件到导入区。支持格式：

- **TXT**：每行 `word` 或 `word [音标] 释义`
- **CSV / TSV**：首列单词，次列释义；自动识别 `word` 表头
- **JSON**：`{"word": "释义"}` 或 `[{"word": "...", "def": "..."}]`
- **XLSX**：Excel，A 列单词，B 列释义

## 权限说明

- `storage`：保存设置、词表、已掌握词、生词本
- `activeTab`：popup 显示当前页面标注数量
- `<all_urls>`：在任意网页上运行内容脚本进行标注。**本扩展不会主动收集或上传任何用户数据**
- 生词释义通过有道词典公开接口查询，仅在按下加入生词本快捷键时发起单次请求，结果缓存至本地

## 数据存储

- 设置项（启用、主题、颜色、快捷键）保存在 `chrome.storage.sync`，跨设备同步
- 词表、已掌握词、生词本、翻译缓存保存在 `chrome.storage.local`，不跨设备

## 技术栈

- Chrome Manifest V3
- 原生 JavaScript / HTML / CSS，无构建依赖
- `TreeWalker` 扫描文本节点，`MutationObserver` 处理 SPA 动态内容
- 手写最小 XLSX 解析器，基于浏览器原生 `DecompressionStream`

## 目录结构

```
extension/
  manifest.json          扩展清单
  background.js          Service Worker（词表初始化、有道翻译代理）
  content.js             内容脚本（DOM 扫描、标注、快捷键）
  parsers.js             自定义词表解析器（TXT/CSV/JSON/XLSX）
  popup.html / popup.js  工具栏弹窗
  options.html / options.js  设置页
  styles/highlight.css   标注样式主题 + Toast
  vocab/                 内置词表 JSON
  icons/                 图标资源
```

## 已知限制

- 词形还原为规则实现，对不规则变化（`went`、`children` 等）识别不到
- 有道词典接口为非官方公开接口，偶有波动；失败时生词本仍会保存单词，释义留空
- 暂不支持同时启用多个词表

## 致谢

- 标注样式 CSS 参考了 [沉浸式翻译](https://github.com/immersive-translate/immersive-translate)
- 内置词表整理自网络公开资源

## License

MIT
