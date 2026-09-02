import { useMemo } from 'react'
import { looseBookmarks, scopeFolderPaths } from '@/core/scan'
import { detectMode } from '@/core/mode'
import { currentLocale, plural, t } from '@/i18n'
import { isLocalBaseUrl, isModelConfigured } from '@/llm/config'
import { activeLlm, type Endpoint } from '@/storage/settings'
import { useStore } from '../store'
import { Detail, detailLabel } from '../components/Detail'
import { IndexSection } from '../components/IndexSection'
import { InlineStatus } from '../components/InlineStatus'
import { PrimaryButton, SecondaryButton, StickyActionBar } from '../components/IndexControls'
import { choiceList, choiceRow, fieldClass } from '../components/buttonStyles'

/**
 * 下拉里那一项「在设置页填别的…」的取值。用一个不可能撞上真实取值的样子：
 * 选中它不是换模型，而是跳去设置页。把「换模型」和「名单里没有我要的」收进
 * 同一个控件，比在旁边再摆一个按钮省一格。
 */
const OPEN_SETTINGS = '::open-settings'

/** 一个可选项的取值。用 \u0000 分隔而不是 `/`——baseUrl 里本来就带斜杠。 */
function optionValue(baseUrl: string, model: string): string {
  return `${baseUrl}\u0000${model}`
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/**
 * 可切换的「端点 × 模型」组合。
 *
 * **只列配好了的端点**：列出一个用不了的组合是个陷阱——选中它，这一页立刻翻成
 * 「还没配置模型」，用户得自己想明白刚才那一下干了什么。本机端点空 Key 算配好了
 * （isModelConfigured 对 localhost 放行，README 明确支持那条路）。
 */
function pickableModels(endpoints: Endpoint[]): Array<{ baseUrl: string; model: string }> {
  return endpoints
    .filter((e) => e.apiKey.trim() !== '' || isLocalBaseUrl(e.baseUrl))
    .flatMap((e) => e.models.map((model) => ({ baseUrl: e.baseUrl, model })))
}

export function PreferencesStep() {
  const {
    scan, settings, setSettings, analyze, busy, reset, modeOverride, setModeOverride, openSettings,
    tree, checkedIds,
  } = useStore()
  const locale = currentLocale()
  // 与后台是同一个纯函数——但前提是同一份扫描结果：书签在 goScan 之后、这次
  // analyze 之前被外部改动（书签管理器里删了个文件夹、同步来一批新的）时，
  // 后台会用它自己重新 scanTree() 出来的结果再判一次，结论可能不同，那时以后台为准。
  // 全部书签走一遍 filter + 建 Map，输入框每敲一个字符都会触发重渲染，
  // 用 useMemo 避免上万条书签的库里每次击键都白算一遍。
  const decision = useMemo(
    () => (scan === null ? null : detectMode(scan, locale)),
    [scan, locale],
  )
  const scopePaths = useMemo(
    () => scopeFolderPaths(tree, [...checkedIds]),
    [tree, checkedIds],
  )
  const loose = useMemo(
    () => (scan === null ? [] : looseBookmarks(scan)),
    [scan],
  )
  if (scan === null || decision === null) return null
  // judgedMessy 是自动判断本身的结论，不受 modeOverride 影响——它决定要不要给出
  // 「归入现有 / 只处理散落书签 / 重新设计」这三选一（逃生口只为「误判成已整理」
  // 那一个方向存在，见下方判「一团乱麻」分支的注释）。rebuild 是这一轮实际会走的
  // 那条路，包含用户的选择，决定三选一里哪一项当前是选中态。
  const judgedMessy = decision.mode === 'rebuild'
  const rebuild = (modeOverride ?? decision.mode) === 'rebuild'
  // 模型配置在设置页，这里只判断配没配。没配时不禁用按钮：一个禁用的按钮既不解释
  // 为什么，也不给出路；换成一个能点、点了直接落到设置页的按钮永远更好。
  // 判断走共用谓词——只认 apiKey 的话，本机 Ollama 用户永远拿不到「开始 AI 分析」，
  // 点「先去配置模型」又回到他刚配完的设置页，来回打转（见 llm/config.ts）。
  const llm = activeLlm(settings)
  const needModel = !isModelConfigured(llm)

  return (
    <div>
      <div data-testid="preferences-section">
        <IndexSection title={t('prefsScanScope')} count={scopePaths.length}>
          {scopePaths.length > 0 && (
            <ul className="space-y-0.5">
              {scopePaths.map((path) => (
                <li key={path} className="break-words font-mono text-sm leading-caption [overflow-wrap:anywhere]">{path}</li>
              ))}
            </ul>
          )}
          <div className={`${scopePaths.length > 0 ? 'mt-3 border-t border-index-line pt-3' : ''} text-sm leading-body`}>
            {judgedMessy ? (
              // 判「一团乱麻」时没有逃生口——这是产品决定（issues/14 §5）：反方向的
              // 误判（该归入现有却推翻）用户在复核页拒不掉，推翻模式下给范围内既有
              // 一级目录改名、加编号前缀，跟接受了几条书签建议无关（见 core/plan.ts
              // 的 participates，对每个既有一级目录恒真）。判错了只能这一轮整个放弃
              // （prefsBack）或事后撤销，所以不给一个「其实我觉得已经整理过」的选项。
              <>
                <p className="font-medium text-index-ink">{t('prefsModeRebuild')}</p>
                <p className="mt-1.5 text-xs leading-body text-index-muted">
                  {t('prefsModeRebuildSummary')}
                </p>
                <div className="mt-2">
                  <Detail label={detailLabel()}>{t('prefsModeRebuildBody')}</Detail>
                </div>
              </>
            ) : (
              <>
                {/* 判断依据——这条不随下面选了哪一项而换字，它讲的始终是「扫描结果
                    看起来是什么样」，跟用户接下来选哪一项是两件事，不矛盾。 */}
                <p className="text-xs leading-body text-index-muted">{decision.reason}</p>
                {/* 三选一并列：归入现有（默认）、只处理散落书签、重新设计整棵树，
                    是同一个维度上的三个点——「这次整理该动多大范围、多深」，
                    不该拆成「一个顶部按钮 + 一个埋在下面选项列表里的勾选框」。 */}
                <div className={`${choiceList} mt-2.5`} role="radiogroup" aria-label={t('prefsModeGroupLabel')}>
                  <label className={`${choiceRow} hover:bg-index-blue-soft`}>
                    <input
                      type="radio"
                      name="prefs-mode"
                      className="h-3.5 w-3.5 shrink-0 accent-index-blue"
                      checked={!rebuild && !settings.onlyLooseInAdditive}
                      onChange={() => {
                        setModeOverride(null)
                        void setSettings({ ...settings, onlyLooseInAdditive: false })
                      }}
                    />
                    <span className="min-w-0 flex-1">{t('prefsModeAdditiveOption')}</span>
                  </label>
                  <Detail flush defaultOpen label={detailLabel()}>{t('prefsModeAdditiveBody')}</Detail>

                  <label className={`${choiceRow} hover:bg-index-blue-soft`}>
                    <input
                      type="radio"
                      name="prefs-mode"
                      className="h-3.5 w-3.5 shrink-0 accent-index-blue"
                      checked={!rebuild && settings.onlyLooseInAdditive}
                      onChange={() => {
                        setModeOverride(null)
                        void setSettings({ ...settings, onlyLooseInAdditive: true })
                      }}
                    />
                    <span className="min-w-0 flex-1">{t('prefsLooseOnlyTitle')}</span>
                  </label>
                  <Detail flush defaultOpen label={detailLabel()}>
                    {`${t('prefsLooseOnlySummary')} ${t('prefsLooseOnlyBody')}`}
                  </Detail>
                  {!rebuild && settings.onlyLooseInAdditive && (
                    <Detail
                      flush
                      wide
                      label={plural(
                        loose.length,
                        'prefsLooseListToggleOne',
                        'prefsLooseListToggleOther',
                        String(loose.length),
                      )}
                    >
                      {loose.length === 0 ? (
                        t('prefsLooseListEmpty')
                      ) : (
                        <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                          {loose.map((item) => {
                            const title = item.title.trim()
                            return (
                              <li key={item.id} className="min-w-0">
                                {title !== '' && (
                                  <div className="break-words [overflow-wrap:anywhere]">{title}</div>
                                )}
                                <div className="break-all text-index-faint">{item.url}</div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </Detail>
                  )}

                  <label className={`${choiceRow} hover:bg-index-blue-soft`}>
                    <input
                      type="radio"
                      name="prefs-mode"
                      className="h-3.5 w-3.5 shrink-0 accent-index-blue"
                      checked={rebuild}
                      onChange={() => setModeOverride('rebuild')}
                    />
                    <span className="min-w-0 flex-1">{t('prefsModeRebuildOption')}</span>
                  </label>
                  <Detail flush defaultOpen label={detailLabel()}>{t('prefsModeRebuildSummary')}</Detail>
                </div>
              </>
            )}
          </div>
        </IndexSection>
      </div>

      {/* 单独一格。「当前范围」讲的是这轮动谁、以及对这批书签的判断——判断句本身
          就在说范围（「范围内一个目录都没有」），它归在那个标题下没错；但清不清空
          文件夹是一条用户偏好，和范围无关，挂在那个标题底下等于说它是范围的一部分。 */}
      <IndexSection title={t('prefsOptionsTitle')}>
        <div className={choiceList} data-testid="prefs-clean-option">
        {/* 说明从 label 里搬了出来。三件事一起解决：dl 套在 label 里本就是无效 HTML；
            它自带的上下边和卡片的行间线会叠成双线；勾选行回到单行高度之后，复选框
            自然落在文字这一行上——原来那句追加的 items-start 根本没生效，Tailwind
            比的是工具类的生成顺序，不是 className 里写的顺序，items-center 永远压得过它，
            复选框于是垂直居中在整块两行高的行里，跟标题错开一截。 */}
          <label className={`${choiceRow} hover:bg-index-blue-soft`}>
            <input
              type="checkbox"
              className="h-3.5 w-3.5 shrink-0 accent-index-blue"
              checked={settings.removeEmptyFolders}
              onChange={(e) => void setSettings({ ...settings, removeEmptyFolders: e.target.checked })}
            />
            <span className="min-w-0 flex-1">{t('prefsCleanTitle')}</span>
          </label>
          <Detail flush defaultOpen label={detailLabel()}>
            {`${t('prefsCleanSummary')} ${t('prefsCleanBody')}`}
          </Detail>
        </div>
      </IndexSection>

      <IndexSection title={t('prefsModelLabel')}>
        {/* 模型状态放在按钮上方：设置藏在齿轮后面，点开始前得看见即将用哪一个；
            没配时也不只靠按钮上那几个字。权限预告仍在两种状态下都摆着。 */}
        {needModel ? (
          <InlineStatus tone="neutral">{t('prefsModelMissing')}</InlineStatus>
        ) : (
          <div className="text-sm leading-caption text-index-muted">
            {/* 分组标题已经写着「将使用」，正文里再写一遍是同一句话摆两行。
                但下拉的可访问名要靠它，所以是视觉隐藏而不是删掉。 */}
            <label htmlFor="model-pick" className="sr-only">{t('prefsModelLabel')}</label>
            <select
              id="model-pick"
              className={fieldClass}
              value={optionValue(settings.active.baseUrl, settings.active.model)}
              onChange={(e) => {
                if (e.target.value === OPEN_SETTINGS) return openSettings()
                const [baseUrl, model] = e.target.value.split('\u0000')
                void setSettings({ ...settings, active: { baseUrl: baseUrl!, model: model! } })
              }}
            >
              {pickableModels(settings.endpoints).map(({ baseUrl, model }) => (
                <option key={optionValue(baseUrl, model)} value={optionValue(baseUrl, model)}>
                  {`${model} · ${hostOf(baseUrl)}`}
                </option>
              ))}
              <option value={OPEN_SETTINGS}>{t('prefsModelElsewhere')}</option>
            </select>
          </div>
        )}
      </IndexSection>
        {/* 权限预告放在按钮上方：申请只发生在点下去的那一刻（chrome.permissions.request()
            要用户手势，设置页是 onChange 即存，放不了），提前说清楚它只要一个域名。
            两种按钮状态下都摆着——它讲的是这条动线接下来会发生什么，不依赖当前是哪个按钮。 */}
        {/* 试过折叠它，收回了：真会撞上浏览器那个权限弹窗的恰恰是已经配好模型的人
            （见本文件同名用例），藏起来弹窗就成了突袭。改成删掉不属于这一屏的那半句
            ——失效链接检查是本地清理里的功能、另一项权限，讲在这里只是把话拉长。 */}
      {/* px-3 跟分组正文对齐：分组内容缩进 12px，这段不缩的话左边缘比上面每一行都探出去一截 */}
      <p className="mt-3 px-3 text-xs leading-body text-index-muted">{t('prefsPermissionNotice')}</p>
      <StickyActionBar>
        <div className="flex gap-2">
          <SecondaryButton onClick={reset}>{t('prefsBack')}</SecondaryButton>
          {needModel ? (
            <PrimaryButton className="flex-1" onClick={openSettings}>
              {t('prefsGoConfigure')}
            </PrimaryButton>
          ) : (
            <PrimaryButton
              className="flex-1"
              disabled={busy !== null}
              onClick={() => void analyze()}
            >
              {t('prefsStart')}
            </PrimaryButton>
          )}
        </div>
      </StickyActionBar>
    </div>
  )
}
