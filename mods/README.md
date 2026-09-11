# 个性化 Mod 示例

设置 → 个性化 Mod 先选择「主题外观」或「角色装饰」进入列表。
点击 Mod 行展开子项配置；行右侧总开关只控制整包启停，不改变子项选择。
总开关关闭时仍可编辑配置，再次开启后恢复之前的子项选择。
本目录的 Cartethyia 主题和卡提西亚战斗随桌面应用提供。内置文件保持只读；
在每行「更多」菜单中复制副本或战斗示例，生成独立目录后再编辑。
旧主题 JSON 和旧 `.cindymod` 文件继续可用。

## 主题外观

参考 `cartethyia-theme/manifest.json`。格式为 `cindy-personal-mod`，
`schemaVersion: 2`，`category: theme`，`template: appearance-v1`。

副本放在 `~/.cindy/themes/packs/<目录名>/`。目录名使用英文字母、数字、短横线；
界面名称 `name` 可以使用中文。`id` 使用小写字母、数字、短横线，保持唯一；
`version` 使用 `1.0.0` 这样的三段版本，与应用版本无关。

```text
my-theme/
├─ manifest.json
├─ colors/
│  ├─ light.json
│  └─ dark.json
└─ assets/
   ├─ head-image-light.png
   ├─ head-image-dark.png
   ├─ logo-light.png
   └─ logo-dark.png
```

`baseFamily: cindy` 提供基础值。`colors.light/dark` 指向颜色覆盖 JSON，
只填写要调整的 Token。示例中的 `sidebar-project-name`、`sidebar-project-icon`、
`sidebar-project-current-bg` 控制项目名称、文件夹图标和当前项目底色。
缺少某个模式的覆盖文件时，使用该模式的基础值。

`assets.light/dark` 支持 `icon`（首页图标）、`logo`（品牌字标）、
`avatar`（普通助手头像）、`loading`（加载字标）、`wordmark`（欢迎页与分享字标）。
登录页使用 `loginHero` / `loginHero2x` 和 `loginWordmark` / `loginWordmark2x`；
授权结果页使用 `statusSuccess` / `statusFailure` / `statusNeutral`；
分享图片中的角色使用 `shareCharacter`。同一张图片可以在多个位置复用。
路径相对于包根目录，只使用 `/`，不能使用绝对路径或 `..`。
当前目录格式使用静态 PNG，每张不超过 8 MiB、800 万像素；建议头像使用透明方图，
Logo 使用透明横图。布局尺寸由应用控制。

`identity.appDisplayName` 是主题建议的应用名称，`identity.assistantName` 是建议的 AI 名称。
展开主题后，可分别开关名称、头像、首页、加载、登录、授权、分享、配色和项目样式。
名称编辑位于对应子项下，按主题独立保存；留空使用包内默认名称。
「恢复子项默认」恢复推荐开关，不自动开启整包，也不清空单独编辑的名称。
停用主题后，主题提供的名称和素材恢复官方 Cindy 默认值。
AI 自称在执行引擎下次启动时生效，不中断已有工作；伙伴与子代理保留各自身份。
引擎与供应商、安装身份、数据目录不会因改名而变化。安装程序与系统注册图标保持 Cindy；
包内 `assets/system` 保存旧版个性化安装素材作为制作参考，不参与运行时覆盖。

替换文件后点击「重新加载主题」，再预览或使用。当前进程内读取失败会保留上一次成功版本，
并显示具体文件错误；首次读取失败使用基础主题，不启动任意包内代码。
卸载把源目录移到 `packs/.disabled`，管理页可恢复；不删除用户源文件。

## 角色装饰

参考 `cartethyia-battle/manifest.json`。`template: composer-battle-v1` 提供已有的战斗行为；
素材包只替换 PNG，不执行脚本。`schemaVersion: 1` 与既有 `.cindymod` 格式兼容。
可以修改 `id`、添加中文 `name`，为自己的角色命名。

点击「复制战斗示例」会生成 `~/.cindy/mods/` 下的副本。替换 `assets/` 中的图片后，
点击「加载战斗目录」选择含 `manifest.json` 的文件夹。重新加载该目录即可更新素材；
只有完整校验、入库成功后才替换当前版本。输入框上方同一时间使用一套战斗素材。
卸载导入素材后恢复内置示例，已有停用选择保持不变。

| 素材键 | 图片尺寸 | 帧数 |
|---|---|---|
| ground | 2168×185 | 地面背景 |
| heroIdle / monsterIdle / monsterDeath / arc / energy / shard | 960×160 | 4 |
| heroMove / heroAttack / heroSleep | 1440×160 | 6 |
| heroSkill / heroHit / monsterHit / impact | 720×160 | 3 |
| heroVictory | 1200×160 | 5 |

精灵帧按水平方向排列，每帧 240×160；保留透明背景。文件名使用小写字母、数字、短横线和 `.png`。
`manifest.json` 中素材值是 `assets/` 下的文件名。全部 15 项必须提供，尺寸需要匹配。
制作目录也可打成 `.cindymod`：

```powershell
node apps/desktop/scripts/package-cartethyia-mod.mjs --source="C:/MyMods/my-battle" --output="C:/MyMods/my-battle.cindymod"
```

不传参数时打包仓内示例；日常编辑可直接用界面加载目录，无需先打包。

主题与角色可以组合使用。角色的地面、伤害数字、效果和待机显示在卡片「配置」中独立开关；
减少动态效果、窗口隐藏与暂停仍由应用统一处理。
