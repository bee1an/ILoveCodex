import type {
  AppLanguage,
  AppTheme,
  AccountRateLimitEntry,
  AccountRateLimits,
  AccountSummary,
  CustomProviderSummary,
  LoginEvent
} from '../../../shared/codex'
import { remainingPercent } from '../../../shared/codex'
export { statusBarAccounts } from '../../../shared/codex'

export const pollingOptions = [5, 15, 30, 60] as const

export const languageOptions: Array<{ value: AppLanguage; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' }
]

export const messages = {
  'zh-CN': {
    unnamedAccount: '未命名账号',
    actionFailed: '操作失败',
    startLoginFailed: '无法启动登录流程',
    readRateLimitFailed: '无法读取账号限额',
    legacyAccountNeedsReimport: '这个账号来自旧版本的钥匙串存储，请重新导入。',
    legacyProviderNeedsApiKey: '这个提供商的 API Key 来自旧版本的钥匙串存储，请重新填写并保存。',
    removeConfirm: (label: string) => `删除 ${label} 的本地保存登录态？`,
    callbackLogin: '回调登录',
    deviceLogin: '设备码登录',
    importCurrent: '导入当前登录',
    importAccountsFile: '导入账号文件',
    exportAccountsFile: '导出账号文件',
    toolbarDialogTitle: '快捷工具',
    closeDialog: '关闭',
    exportFormatDialogTitle: '选择导出格式',
    exportFormatDialogDescription: '导入会自动识别格式；导出时请选择目标工具兼容的 JSON 结构。',
    exportFormatTargetAll: '导出全部账号',
    exportFormatTargetSelected: (count: number) => `导出选中的 ${count} 个账号`,
    exportFormatIlovecodex: 'ILoveCodex',
    exportFormatIlovecodexDescription: '原生模板，保留完整额度与扩展字段。',
    exportFormatCockpitTools: 'Cockpit Tools',
    exportFormatCockpitToolsDescription: '兼容 Cockpit Tools 的账号数组格式。',
    exportFormatSub2api: 'sub2api',
    exportFormatSub2apiDescription: '兼容 sub2api 的批量导入数据格式。',
    exportFormatCliProxyApi: 'CLIProxyAPI',
    exportFormatCliProxyApiDescription: '兼容 CLIProxyAPI 的 token storage 格式。',
    exportFormatConfirm: '开始导出',
    exportFormatCancel: '取消',
    switchBest: '切换到最优账号',
    alreadyBest: '当前已是最优账号',
    noBestAccount: '暂无可切换账号',
    switchToAccount: (email: string) => `切换到 ${email}`,
    settings: '设置',
    pollingInterval: '额度轮询',
    autoCheckUpdates: '启动时检查更新',
    showLocalMockData: '显示本地 Mock 数据',
    codexDesktopExecutablePath: '多开 Codex EXE',
    showCodexDesktopExecutablePath: '手动指定',
    hideCodexDesktopExecutablePath: '收起',
    codexDesktopExecutablePlaceholder: '例如 C:\\Program Files\\Codex\\Codex.exe',
    minutes: '分钟',
    callbackLoginLink: '授权链接',
    deviceLoginLink: '设备验证页面',
    deviceCode: '设备码',
    copyLink: '复制链接',
    copyCode: '复制设备码',
    openBrowser: '打开浏览器',
    openMainPanel: '打开主面板',
    waitingCallback: '等待在浏览器中完成授权并回调到本地地址。',
    waitingDeviceCode: '在浏览器里完成授权后，这里会自动继续。',
    statusBarAccountCount: (count: number) => `${count} 个状态栏账号`,
    noStatusBarAccounts: '还没有可显示的账号。',
    statusBarDisplayAccounts: '状态栏显示账号',
    maxFiveAccounts: '最多 5 个',
    visible: '已显示',
    hidden: '未显示',
    accountList: '账号列表',
    accountCount: (count: number) => `${count} 个账号`,
    tokenStats: '用量',
    tokenStatsTitle: '用量 / 消耗统计',
    tokenStatsDescription:
      '本页以 token 作为主展示维度；cost 只作为副文案与 tooltip。实例数据来自本地 Codex 日志，账号数据仅展示真实额度与 credits。',
    tokenStatsReadFailed: '无法读取用量统计',
    tokenStatsSelectedTarget: '当前统计目标',
    tokenStatsDefaultFallback: '无运行实例，回退 default',
    tokenStatsNoData: '暂无本地用量数据',
    runningTokenCostSummary: '全部实例汇总',
    runningInstanceCount: (count: number) => `${count} 个运行实例`,
    today: 'Today',
    last30Days: 'Last 30 days',
    tokens: 'tokens',
    cost: 'cost',
    costReference: (value: string) => `成本参考 ${value}`,
    updatedAt: '更新时间',
    dailyTrend: '30 天日趋势',
    modelBreakdown: '模型分布',
    instanceUsage: '实例用量/消耗',
    instanceUsageDescription: '按实例汇总近 30 天 token；cost 仅作辅助信息。',
    accountUsage: '账号用量',
    accountUsageDescription:
      '基于已读取的 rate limits / credits 展示账号额度，不做 token 或 cost 归因。',
    displayConfig: '显示配置',
    displayConfigDescription: '勾选后会在统计页显示，对应设置会持久化到本地。',
    noAccountUsageData: '暂无账号额度数据，先在账号列表刷新额度。',
    noChartsVisible: '已隐藏全部图表，可在上方显示配置中重新开启。',
    sessionUsed: '5小时已用',
    weeklyUsed: '周限额已用',
    credits: 'Credits',
    unlimited: '无限',
    refresh: '刷新',
    refreshing: '刷新中',
    selectedAccountCount: (count: number) => `已选 ${count} 个账号`,
    selectAccount: '选择账号',
    selectAllVisibleAccounts: '全选当前筛选',
    clearSelectedAccounts: '清空选择',
    exportSelectedAccounts: '导出选中',
    deleteSelectedAccounts: '删除选中',
    removeSelectedConfirm: (count: number) => `删除选中的 ${count} 个本地保存登录态？`,
    providerList: '提供商列表',
    providerCount: (count: number) => `${count} 个提供商`,
    dragSortHint: '拖动左侧手柄调整顺序',
    dragSortHandle: '拖动排序',
    tagManager: '标签管理',
    hideTagManager: '收起标签管理',
    newTagPlaceholder: '输入新标签名',
    createTag: '新增标签',
    editTag: '编辑标签',
    renameTag: '重命名标签',
    deleteTag: '删除标签',
    save: '保存',
    cancel: '取消',
    allTags: '全部',
    untagged: '未打标签',
    filterByTag: '按标签筛选',
    filtersAndBulkActions: '筛选与批量操作',
    showFiltersAndBulkActions: '展开筛选与批量操作',
    hideFiltersAndBulkActions: '收起筛选与批量操作',
    emptyFilterTools: '导入账号后再进行筛选或批量操作',
    tagsForAccount: '账号标签',
    addTag: '添加标签',
    removeTag: '移除标签',
    noAvailableTags: '没有可添加标签',
    tagSummary: (tagCount: number, linkedAccountCount: number) =>
      `${tagCount} 个标签，已关联 ${linkedAccountCount} 个账号`,
    taggedAccountCount: (count: number) => `${count} 个账号`,
    noTags: '还没有标签，先在上方新增一个。',
    noAccountsForFilter: '当前筛选下没有账号。',
    deleteTagConfirm: (name: string) => `删除标签 ${name}？已绑定账号会一并取消关联。`,
    active: '当前',
    accountExpired: '已过期',
    accountUsageRefreshFailed: '刷新失败',
    accountExpiredHint: '登录态已失效，请重新登录或重新导入当前登录。',
    sessionQuota: '5小时',
    weeklyQuota: '周限额',
    sessionReset: '5小时重置',
    weeklyReset: '周限额重置',
    openCodex: '打开 Codex',
    openCodexIsolated: '多开 Codex',
    openCustomProvider: '启动提供商',
    switchAccount: '切换账号',
    refreshQuota: '刷新额度',
    wakeQuota: '唤醒',
    wakeQuotaHint: '发送一条请求来启动这轮 Session 计时',
    wakeQuotaUnsupported: 'Free 层级不支持唤醒',
    wakeSchedule: '定时唤醒',
    wakeScheduleHint: '按设定时间自动发送唤醒请求',
    wakeDialogTitle: '唤醒中心',
    wakeDialogDescription: '可立即发送唤醒请求，也可以在同一个弹框里配置定时唤醒。',
    wakeScheduleDialogTitle: '定时唤醒',
    wakeScheduleDialogDescription: '按本地时间在设定时刻自动发送唤醒请求。',
    wakeScheduleEnabled: '启用定时唤醒',
    wakeScheduleTimes: '时间',
    wakeScheduleAddTime: '新增时间',
    wakeScheduleTimePlaceholder: '例如：09:00',
    wakeScheduleRemoveTime: '删除时间',
    wakeScheduleNextRun: '下次触发',
    wakeScheduleLastRun: '上次执行',
    wakeScheduleLastStatus: '上次结果',
    wakeScheduleLastMessage: '结果详情',
    wakeScheduleDelete: '删除计划',
    wakeScheduleSave: '保存计划',
    wakeScheduleNoTimes: '至少添加一个时间',
    wakeScheduleInvalidTime: '时间格式必须是 HH:mm',
    wakeScheduleEmpty: '未设置',
    wakeScheduleStatusIdle: '待命',
    wakeScheduleStatusSuccess: '成功',
    wakeScheduleStatusError: '失败',
    wakeScheduleStatusSkipped: '跳过',
    wakeQuotaDialogTitle: '唤醒 Session',
    wakeQuotaDialogDescription: '发送一条请求来启动这轮 Session 计时。',
    wakeQuotaPromptLabel: '唤醒词',
    wakeQuotaPromptPlaceholder: '例如：ping',
    wakeQuotaModelLabel: '模型',
    wakeQuotaModelPlaceholder: '例如：gpt-5.4',
    wakeQuotaConfirm: '开始唤醒',
    wakeQuotaCancel: '取消',
    wakeQuotaStatusIdle: '待命',
    wakeQuotaStatusRunning: '进行中',
    wakeQuotaStatusSuccess: '已完成',
    wakeQuotaStatusSkipped: '已跳过',
    wakeQuotaStatusError: '失败',
    wakeQuotaLogTitle: '过程输出',
    wakeQuotaLogEmpty: '还没有输出，点击下方开始唤醒后会在这里显示过程。',
    wakeQuotaLogReady: (label: string) => `已准备对 ${label} 发起唤醒测试。`,
    wakeQuotaLogStart: (model: string) => `开始唤醒测试，模型：${model}`,
    wakeQuotaLogPrompt: (prompt: string) => `Prompt：${prompt}`,
    wakeQuotaLogRequesting: '正在发送唤醒请求…',
    wakeQuotaLogAccepted: (status: number) => `请求已返回，状态码：${status}`,
    wakeQuotaLogResponse: (text: string) => `最终返回：${text}`,
    wakeQuotaLogRefreshingUsage: '正在刷新额度状态…',
    wakeQuotaLogSessionReset: (value: string) => `Session 重置时间：${value}`,
    wakeQuotaLogWeeklyReset: (value: string) => `周限额重置时间：${value}`,
    wakeQuotaLogCompleted: '唤醒流程完成。',
    wakeQuotaLogSkipped: '当前条件已变化，本次没有真正触发唤醒请求。',
    wakeQuotaLogFailed: (message: string) => `唤醒失败：${message}`,
    wakeQuotaResult: '请求结果',
    wakeQuotaResultStatus: '状态',
    wakeQuotaResultEmpty: '空响应',
    refreshAllQuota: '刷新全部额度',
    refreshQuotaBlocked: (minutes: number) => `${minutes} 分钟内不重复请求`,
    deleteSaved: '删除保存',
    noSavedAccounts: '还没有保存任何账号。先导入当前登录，或者走一次新的回调登录。',
    providerNamePlaceholder: '提供商名称（可选）',
    providerBaseUrlPlaceholder: '提供商 Base URL',
    providerApiKeyPlaceholder: '提供商 API Key',
    providerModelPlaceholder: '模型（默认 5.4）',
    providerFastMode: '开启 Fast Mode',
    createProvider: '新增提供商',
    editProvider: '编辑提供商',
    saveProvider: '保存提供商',
    deleteProvider: '删除提供商',
    deleteProviderConfirm: (label: string) => `删除提供商 ${label}？`,
    providerBadge: '自定义提供商',
    providerEmptyName: 'custom',
    noProviders: '还没有自定义提供商。',
    instanceManager: '实例管理',
    instanceManagerHint: '独立实例使用独立 CODEX_HOME，首次创建会复制当前 .codex。',
    instanceCount: (count: number) => `${count} 个实例`,
    defaultInstance: '默认实例',
    instanceNamePlaceholder: '实例名称',
    instanceDirPlaceholder: '实例目录（可选）',
    instanceArgsPlaceholder: '附加启动参数（可选）',
    instanceBindAccount: '绑定账号',
    instanceUnbound: '不绑定账号',
    createInstance: '创建实例',
    saveInstance: '保存实例',
    startInstance: '启动实例',
    stopInstance: '停止实例',
    deleteInstance: '删除实例',
    deleteInstanceConfirm: (name: string) => `删除实例 ${name}？实例目录也会被删除。`,
    instanceDirectory: '实例目录',
    instanceStatusRunning: '运行中',
    instanceStatusStopped: '未运行',
    instanceInitialized: '已初始化',
    instanceNeedsInit: '首次启动时初始化',
    defaultInstanceRoot: '默认实例目录',
    switchLanguage: '切换语言',
    switchTheme: (current: string) => `切换主题，当前${current}`,
    openGithub: '打开 GitHub',
    githubPending: 'GitHub 链接待配置',
    checkUpdates: '检查更新',
    checkingUpdates: '检查更新中',
    downloadUpdate: (version?: string) => `下载更新${version ? ` v${version}` : ''}`,
    updatingViaHomebrew: '正在通过 Homebrew 更新…',
    homebrewUpdateStatus: (status?: string, command?: string) => {
      switch (status) {
        case 'brew-update':
          return `正在执行：${command ?? 'brew update'}`
        case 'waiting-for-app-quit':
          return 'Homebrew 已准备安装，正在关闭应用…'
        case 'brew-upgrade':
          return `正在执行：${command ?? 'brew upgrade --cask ilovecodex'}`
        case 'reopening':
          return '正在重新打开应用…'
        default:
          return command ? `正在执行：${command}` : '正在通过 Homebrew 更新…'
      }
    },
    updateViaHomebrew: (version?: string) => `通过 Homebrew 更新${version ? ` v${version}` : ''}`,
    openReleasePage: (version?: string) => `前往下载${version ? ` v${version}` : ''}`,
    restartToInstallUpdate: '重启安装更新',
    updateReady: '更新已下载，重启后安装。',
    updateUpToDate: '当前已是最新版本。',
    updateAvailableVersion: (version?: string) =>
      version ? `发现新版本 v${version}` : '发现新版本',
    updateDownloadProgress: (progress?: number) => `下载中 ${progress ?? 0}%`,
    updatesUnsupported: '当前构建不支持自动更新',
    updateFailed: '检查更新失败',
    lightTheme: '浅色主题',
    darkTheme: '深色主题',
    systemTheme: '跟随系统',
    portOccupied: (command: string, pid: number) => `1455 端口当前被 ${command} (${pid}) 占用`,
    killPortOccupant: '结束占用进程',
    killPortOccupantFailed: '无法结束占用 1455 端口的进程',
    emptyStateTitle: '还没有账号',
    emptyStateDescription: '导入当前登录，或者新建一次回调登录。',
    importCurrentHint: '导入当前登录',
    importCurrentDetail: '适合你已经在本机 Codex 里登录过账号的情况。',
    callbackLoginHint: '新建回调登录',
    callbackLoginDetail: '适合补充新账号，授权完成后会自动回调导入。',
    deviceLoginHint: '设备码登录',
    deviceLoginDetail: '适合在别的设备或浏览器里完成授权，再回到这里自动导入。'
  },
  en: {
    unnamedAccount: 'Unnamed account',
    actionFailed: 'Action failed',
    startLoginFailed: 'Unable to start login flow',
    readRateLimitFailed: 'Unable to read account limits',
    legacyAccountNeedsReimport:
      'This account was saved by an older Keychain-backed version. Re-import it to continue.',
    legacyProviderNeedsApiKey:
      'This provider API key was saved by an older Keychain-backed version. Enter it again and save the provider.',
    removeConfirm: (label: string) => `Remove the saved local session for ${label}?`,
    callbackLogin: 'Callback login',
    deviceLogin: 'Device code login',
    importCurrent: 'Import current login',
    importAccountsFile: 'Import account file',
    exportAccountsFile: 'Export account file',
    toolbarDialogTitle: 'Quick tools',
    closeDialog: 'Close',
    exportFormatDialogTitle: 'Choose export format',
    exportFormatDialogDescription:
      'Import auto-detects the source format. Choose the JSON structure that matches the target tool when exporting.',
    exportFormatTargetAll: 'Export all accounts',
    exportFormatTargetSelected: (count: number) =>
      `Export ${count} selected account${count === 1 ? '' : 's'}`,
    exportFormatIlovecodex: 'ILoveCodex',
    exportFormatIlovecodexDescription:
      'Native template with the full quota and extra metadata preserved.',
    exportFormatCockpitTools: 'Cockpit Tools',
    exportFormatCockpitToolsDescription: 'Compatible with the Cockpit Tools account array format.',
    exportFormatSub2api: 'sub2api',
    exportFormatSub2apiDescription: 'Compatible with the sub2api bulk import data format.',
    exportFormatCliProxyApi: 'CLIProxyAPI',
    exportFormatCliProxyApiDescription: 'Compatible with the CLIProxyAPI token storage format.',
    exportFormatConfirm: 'Export',
    exportFormatCancel: 'Cancel',
    switchBest: 'Switch to best account',
    alreadyBest: 'Already using best account',
    noBestAccount: 'No account to switch to',
    switchToAccount: (email: string) => `Switch to ${email}`,
    settings: 'Settings',
    pollingInterval: 'Usage polling',
    autoCheckUpdates: 'Check updates on startup',
    showLocalMockData: 'Show local mock data',
    codexDesktopExecutablePath: 'Multi-open Codex EXE',
    showCodexDesktopExecutablePath: 'Manual path',
    hideCodexDesktopExecutablePath: 'Hide',
    codexDesktopExecutablePlaceholder: 'For example C:\\Program Files\\Codex\\Codex.exe',
    minutes: 'min',
    callbackLoginLink: 'Authorization URL',
    deviceLoginLink: 'Device verification URL',
    deviceCode: 'Device code',
    copyLink: 'Copy link',
    copyCode: 'Copy code',
    openBrowser: 'Open browser',
    openMainPanel: 'Open main panel',
    waitingCallback: 'Waiting for authorization in the browser to call back to the local app.',
    waitingDeviceCode:
      'Finish authorization in the browser and Ilovecodex will continue automatically.',
    statusBarAccountCount: (count: number) => `${count} menu bar account${count === 1 ? '' : 's'}`,
    noStatusBarAccounts: 'No account selected for the menu bar.',
    statusBarDisplayAccounts: 'Menu bar accounts',
    maxFiveAccounts: 'Up to 5 accounts',
    visible: 'Shown',
    hidden: 'Hidden',
    accountList: 'Accounts',
    accountCount: (count: number) => `${count} account${count === 1 ? '' : 's'}`,
    tokenStats: 'Usage',
    tokenStatsTitle: 'Usage / consumption stats',
    tokenStatsDescription:
      'Tokens are the primary metric here; cost is only supplementary copy and tooltip detail. Instance data comes from local Codex logs, while account data only reflects real rate limits and credits.',
    tokenStatsReadFailed: 'Unable to read usage stats',
    tokenStatsSelectedTarget: 'Selected target',
    tokenStatsDefaultFallback: 'No running instance, falling back to default',
    tokenStatsNoData: 'No local usage data yet',
    runningTokenCostSummary: 'All instances summary',
    runningInstanceCount: (count: number) => `${count} running instance${count === 1 ? '' : 's'}`,
    today: 'Today',
    last30Days: 'Last 30 days',
    tokens: 'tokens',
    cost: 'cost',
    costReference: (value: string) => `Cost reference ${value}`,
    updatedAt: 'Updated',
    dailyTrend: '30-day daily trend',
    modelBreakdown: 'Model breakdown',
    instanceUsage: 'Instance usage / consumption',
    instanceUsageDescription: 'Aggregates 30-day tokens by instance, with cost kept as context only.',
    accountUsage: 'Account usage',
    accountUsageDescription:
      'Shows real account rate limits and credits only, without inventing token or cost attribution.',
    displayConfig: 'Display config',
    displayConfigDescription: 'Checked charts stay visible on the stats page and persist locally.',
    noAccountUsageData: 'No account usage data yet. Refresh usage from the accounts list first.',
    noChartsVisible: 'All charts are hidden. Re-enable them from the display config above.',
    sessionUsed: 'Session used',
    weeklyUsed: 'Weekly used',
    credits: 'Credits',
    unlimited: 'Unlimited',
    refresh: 'Refresh',
    refreshing: 'Refreshing',
    selectedAccountCount: (count: number) => `${count} selected account${count === 1 ? '' : 's'}`,
    selectAccount: 'Select account',
    selectAllVisibleAccounts: 'Select visible',
    clearSelectedAccounts: 'Clear selection',
    exportSelectedAccounts: 'Export selected',
    deleteSelectedAccounts: 'Delete selected',
    removeSelectedConfirm: (count: number) =>
      `Remove the ${count} selected saved local session${count === 1 ? '' : 's'}?`,
    providerList: 'Providers',
    providerCount: (count: number) => `${count} provider${count === 1 ? '' : 's'}`,
    dragSortHint: 'Drag the left handle to reorder',
    dragSortHandle: 'Drag to reorder',
    tagManager: 'Manage tags',
    hideTagManager: 'Hide tag manager',
    newTagPlaceholder: 'Enter a new tag name',
    createTag: 'Create tag',
    editTag: 'Edit tag',
    renameTag: 'Rename tag',
    deleteTag: 'Delete tag',
    save: 'Save',
    cancel: 'Cancel',
    allTags: 'All',
    untagged: 'Untagged',
    filterByTag: 'Filter by tag',
    filtersAndBulkActions: 'Filters & bulk actions',
    showFiltersAndBulkActions: 'Show filters and bulk actions',
    hideFiltersAndBulkActions: 'Hide filters and bulk actions',
    emptyFilterTools: 'Import accounts to unlock filters and bulk actions',
    tagsForAccount: 'Account tags',
    addTag: 'Add tag',
    removeTag: 'Remove tag',
    noAvailableTags: 'No tags available to add',
    tagSummary: (tagCount: number, linkedAccountCount: number) =>
      `${tagCount} tag${tagCount === 1 ? '' : 's'}, linked to ${linkedAccountCount} account${linkedAccountCount === 1 ? '' : 's'}`,
    taggedAccountCount: (count: number) => `${count} account${count === 1 ? '' : 's'}`,
    noTags: 'No tags yet. Create one above first.',
    noAccountsForFilter: 'No accounts match the current filter.',
    deleteTagConfirm: (name: string) =>
      `Delete tag ${name}? It will also be removed from any assigned accounts.`,
    active: 'Active',
    accountExpired: 'Expired',
    accountUsageRefreshFailed: 'Refresh failed',
    accountExpiredHint: 'Session is no longer valid. Sign in again or re-import the current login.',
    sessionQuota: 'Session',
    weeklyQuota: 'Weekly',
    sessionReset: 'Session resets',
    weeklyReset: 'Weekly resets',
    openCodex: 'Open Codex',
    openCodexIsolated: 'Open isolated Codex',
    openCustomProvider: 'Launch provider',
    switchAccount: 'Switch account',
    refreshQuota: 'Refresh usage',
    wakeQuota: 'Wake',
    wakeQuotaHint: 'Send a request to start the current session timer',
    wakeQuotaUnsupported: 'Wake is not supported on the Free plan',
    wakeSchedule: 'Wake schedule',
    wakeScheduleHint: 'Send wake requests automatically on a schedule',
    wakeDialogTitle: 'Wake center',
    wakeDialogDescription:
      'Send an immediate wake request or configure the wake schedule from the same dialog.',
    wakeScheduleDialogTitle: 'Wake schedule',
    wakeScheduleDialogDescription: 'Automatically send wake requests at the selected local times.',
    wakeScheduleEnabled: 'Enable scheduled wake',
    wakeScheduleTimes: 'Times',
    wakeScheduleAddTime: 'Add time',
    wakeScheduleTimePlaceholder: 'For example: 09:00',
    wakeScheduleRemoveTime: 'Remove time',
    wakeScheduleNextRun: 'Next run',
    wakeScheduleLastRun: 'Last run',
    wakeScheduleLastStatus: 'Last result',
    wakeScheduleLastMessage: 'Result detail',
    wakeScheduleDelete: 'Delete schedule',
    wakeScheduleSave: 'Save schedule',
    wakeScheduleNoTimes: 'Add at least one time',
    wakeScheduleInvalidTime: 'Time must use HH:mm format',
    wakeScheduleEmpty: 'Not set',
    wakeScheduleStatusIdle: 'Idle',
    wakeScheduleStatusSuccess: 'Success',
    wakeScheduleStatusError: 'Error',
    wakeScheduleStatusSkipped: 'Skipped',
    wakeQuotaDialogTitle: 'Wake session',
    wakeQuotaDialogDescription: 'Send a request to start this session timer.',
    wakeQuotaPromptLabel: 'Prompt',
    wakeQuotaPromptPlaceholder: 'For example: ping',
    wakeQuotaModelLabel: 'Model',
    wakeQuotaModelPlaceholder: 'For example: gpt-5.4',
    wakeQuotaConfirm: 'Wake now',
    wakeQuotaCancel: 'Cancel',
    wakeQuotaStatusIdle: 'Idle',
    wakeQuotaStatusRunning: 'Running',
    wakeQuotaStatusSuccess: 'Done',
    wakeQuotaStatusSkipped: 'Skipped',
    wakeQuotaStatusError: 'Failed',
    wakeQuotaLogTitle: 'Output',
    wakeQuotaLogEmpty: 'No output yet. Start the wake request below to see progress here.',
    wakeQuotaLogReady: (label: string) => `Ready to wake ${label}.`,
    wakeQuotaLogStart: (model: string) => `Starting wake flow with model ${model}`,
    wakeQuotaLogPrompt: (prompt: string) => `Prompt: ${prompt}`,
    wakeQuotaLogRequesting: 'Sending wake request…',
    wakeQuotaLogAccepted: (status: number) => `Request returned with status ${status}`,
    wakeQuotaLogResponse: (text: string) => `Final response: ${text}`,
    wakeQuotaLogRefreshingUsage: 'Refreshing usage state…',
    wakeQuotaLogSessionReset: (value: string) => `Session reset: ${value}`,
    wakeQuotaLogWeeklyReset: (value: string) => `Weekly reset: ${value}`,
    wakeQuotaLogCompleted: 'Wake flow completed.',
    wakeQuotaLogSkipped: 'Wake request was skipped because the condition changed.',
    wakeQuotaLogFailed: (message: string) => `Wake failed: ${message}`,
    wakeQuotaResult: 'Response',
    wakeQuotaResultStatus: 'Status',
    wakeQuotaResultEmpty: 'Empty response',
    refreshAllQuota: 'Refresh all usage',
    refreshQuotaBlocked: (minutes: number) => `No repeat request within ${minutes} min`,
    deleteSaved: 'Delete saved login',
    noSavedAccounts:
      'No saved accounts yet. Import the current login or start a new callback login.',
    providerNamePlaceholder: 'Provider name (optional)',
    providerBaseUrlPlaceholder: 'Provider base URL',
    providerApiKeyPlaceholder: 'Provider API key',
    providerModelPlaceholder: 'Model (default 5.4)',
    providerFastMode: 'Enable Fast Mode',
    createProvider: 'Create provider',
    editProvider: 'Edit provider',
    saveProvider: 'Save provider',
    deleteProvider: 'Delete provider',
    deleteProviderConfirm: (label: string) => `Delete provider ${label}?`,
    providerBadge: 'Custom provider',
    providerEmptyName: 'custom',
    noProviders: 'No custom providers yet.',
    instanceManager: 'Instances',
    instanceManagerHint:
      'Each instance uses its own CODEX_HOME and copies the current .codex on first creation.',
    instanceCount: (count: number) => `${count} instance${count === 1 ? '' : 's'}`,
    defaultInstance: 'Default instance',
    instanceNamePlaceholder: 'Instance name',
    instanceDirPlaceholder: 'Instance directory (optional)',
    instanceArgsPlaceholder: 'Extra launch arguments (optional)',
    instanceBindAccount: 'Bound account',
    instanceUnbound: 'No bound account',
    createInstance: 'Create instance',
    saveInstance: 'Save instance',
    startInstance: 'Start instance',
    stopInstance: 'Stop instance',
    deleteInstance: 'Delete instance',
    deleteInstanceConfirm: (name: string) =>
      `Delete instance ${name}? Its instance directory will also be removed.`,
    instanceDirectory: 'Instance directory',
    instanceStatusRunning: 'Running',
    instanceStatusStopped: 'Stopped',
    instanceInitialized: 'Initialized',
    instanceNeedsInit: 'Initialized on first start',
    defaultInstanceRoot: 'Default instance directory',
    switchLanguage: 'Switch language',
    switchTheme: (current: string) => `Switch theme, current ${current}`,
    openGithub: 'Open GitHub',
    githubPending: 'GitHub link not configured',
    checkUpdates: 'Check for updates',
    checkingUpdates: 'Checking for updates',
    downloadUpdate: (version?: string) => `Download update${version ? ` v${version}` : ''}`,
    updatingViaHomebrew: 'Updating through Homebrew…',
    homebrewUpdateStatus: (status?: string, command?: string) => {
      switch (status) {
        case 'brew-update':
          return `Running: ${command ?? 'brew update'}`
        case 'waiting-for-app-quit':
          return 'Homebrew is ready to install, closing the app…'
        case 'brew-upgrade':
          return `Running: ${command ?? 'brew upgrade --cask ilovecodex'}`
        case 'reopening':
          return 'Reopening the app…'
        default:
          return command ? `Running: ${command}` : 'Updating through Homebrew…'
      }
    },
    updateViaHomebrew: (version?: string) => `Update with Homebrew${version ? ` v${version}` : ''}`,
    openReleasePage: (version?: string) => `Open download page${version ? ` v${version}` : ''}`,
    restartToInstallUpdate: 'Restart to install update',
    updateReady: 'Update downloaded and ready to install.',
    updateUpToDate: 'Already up to date.',
    updateAvailableVersion: (version?: string) =>
      version ? `Update v${version} is available.` : 'An update is available.',
    updateDownloadProgress: (progress?: number) => `Downloading ${progress ?? 0}%`,
    updatesUnsupported: 'Automatic updates are not available for this build.',
    updateFailed: 'Update check failed',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    systemTheme: 'System theme',
    portOccupied: (command: string, pid: number) =>
      `Port 1455 is currently in use by ${command} (${pid})`,
    killPortOccupant: 'Kill occupying process',
    killPortOccupantFailed: 'Unable to terminate the process using port 1455',
    emptyStateTitle: 'No accounts yet',
    emptyStateDescription: 'Import the current login or start a callback login.',
    importCurrentHint: 'Import current login',
    importCurrentDetail:
      'Best when this machine is already signed in through Codex and you want to pull it in immediately.',
    callbackLoginHint: 'Start callback login',
    callbackLoginDetail:
      'Best when you want to add another account and let the local callback finish automatically.',
    deviceLoginHint: 'Use device code',
    deviceLoginDetail:
      'Best when you want to approve the login on another browser or device and let Ilovecodex poll automatically.'
  }
} as const

export type LocalizedCopy = (typeof messages)['zh-CN']

export function accountLabel(
  account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>,
  copy: LocalizedCopy
): string {
  return account.name ?? account.email ?? account.accountId ?? copy.unnamedAccount
}

export function accountEmail(
  account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>,
  copy: LocalizedCopy
): string {
  return account.email ?? account.name ?? account.accountId ?? copy.unnamedAccount
}

export function providerLabel(
  provider: Pick<CustomProviderSummary, 'name' | 'baseUrl'>,
  copy: Pick<LocalizedCopy, 'providerEmptyName'>
): string {
  return provider.name?.trim() || provider.baseUrl || copy.providerEmptyName
}

export function planLabel(planType?: string | null): string {
  switch ((planType ?? '').toLowerCase()) {
    case 'free':
      return 'Free'
    case 'plus':
      return 'Plus'
    case 'pro':
      return 'Pro'
    case 'team':
      return 'Team'
    case 'enterprise':
      return 'Enterprise'
    default:
      return planType || '--'
  }
}

export function planTagClass(planType?: string | null): string {
  switch ((planType ?? '').toLowerCase()) {
    case 'free':
      return 'theme-plan-neutral bg-black/[0.05] text-black/72'
    case 'plus':
      return 'theme-plan-plus bg-emerald-500/12 text-emerald-700'
    case 'pro':
      return 'theme-plan-pro bg-sky-500/12 text-sky-700'
    case 'team':
      return 'theme-plan-team bg-amber-500/14 text-amber-700'
    case 'enterprise':
      return 'theme-plan-enterprise bg-rose-500/14 text-rose-700'
    default:
      return 'theme-plan-neutral bg-black/[0.05] text-black/72'
  }
}

export function loginTone(phase: LoginEvent['phase']): string {
  if (phase === 'success') {
    return 'text-success'
  }

  if (phase === 'error' || phase === 'cancelled') {
    return 'text-danger'
  }

  return 'text-ink'
}

export function accountCardTone(active: boolean): string {
  return active
    ? 'theme-account-card theme-account-card-active border-[var(--line-strong)] bg-[var(--surface-selected)]'
    : 'theme-account-card border-[var(--line)] bg-[var(--panel-strong)]'
}

export function usageErrorKind(message?: string): 'expired' | 'workspace' | 'error' | null {
  if (!message) {
    return null
  }

  const normalized = message.toLowerCase()

  if (normalized.includes('deactivated_workspace')) {
    return 'workspace'
  }

  if (
    normalized.includes('invalid_grant') ||
    normalized.includes('refresh_token_expired') ||
    normalized.includes('refresh_token_reused') ||
    normalized.includes('refresh_token_invalidated') ||
    normalized.includes('already used') ||
    normalized.includes('revoked') ||
    normalized.includes('missing refresh token') ||
    normalized.includes('missing access token') ||
    normalized.includes('token refresh failed (401)') ||
    normalized.includes('token refresh failed (403)') ||
    normalized.includes('failed: 401') ||
    normalized.includes('failed: 403')
  ) {
    return 'expired'
  }

  return 'error'
}

function usageErrorDetail(
  message: string,
  account?: Pick<AccountSummary, 'id' | 'email' | 'name' | 'accountId'>
): string {
  const normalized = message.trim()
  if (!normalized || !account) {
    return normalized
  }

  const prefixes = [account.email, account.name, account.accountId, account.id].filter(
    (value): value is string => Boolean(value)
  )
  for (const prefix of prefixes) {
    if (normalized.startsWith(`${prefix}: `)) {
      return normalized.slice(prefix.length + 2).trim()
    }
  }

  return normalized
}

export function accountUsageBadge(
  message: string | undefined,
  account: Pick<AccountSummary, 'id' | 'email' | 'name' | 'accountId'>,
  copy: Pick<LocalizedCopy, 'accountExpired' | 'accountExpiredHint' | 'accountUsageRefreshFailed'>
): { kind: 'expired' | 'workspace' | 'error'; title: string; detail: string } | null {
  const kind = usageErrorKind(message)

  if (!message || !kind) {
    return null
  }

  const detail = usageErrorDetail(message, account)

  if (kind === 'expired') {
    return {
      kind,
      detail,
      title: `${copy.accountExpiredHint}\n${detail}`
    }
  }

  return {
    kind,
    detail,
    title: detail
  }
}

export function progressWidth(value?: number | null): string {
  return `${remainingPercent(value)}%`
}

function normalizeResetTimestamp(value?: number | null): number | null {
  if (!value) {
    return null
  }

  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function weeklyResetTimeToneClass(value?: number | null, now = Date.now()): string {
  const normalized = normalizeResetTimestamp(value)
  if (!normalized) {
    return 'text-muted-strong'
  }

  const diffMs = normalized - now
  if (diffMs <= 0) {
    return 'text-emerald-700'
  }

  const remainingDays = Math.ceil(diffMs / (24 * 60 * 60_000))

  if (remainingDays <= 1) {
    return 'text-emerald-700'
  }

  if (remainingDays <= 3) {
    return 'text-sky-700'
  }

  if (remainingDays <= 5) {
    return 'text-amber-700'
  }

  return 'text-red-700'
}

export function limitLabel(limit: AccountRateLimitEntry): string {
  const raw = (limit.limitName ?? limit.limitId ?? '').toLowerCase()

  if (raw.includes('review')) {
    return 'review'
  }

  if (raw.includes('codex')) {
    return 'codex'
  }

  return limit.limitName ?? limit.limitId ?? 'extra'
}

export function themeIconClass(theme: AppTheme): string {
  switch (theme) {
    case 'dark':
      return 'i-lucide-moon-star'
    case 'system':
      return 'i-lucide-monitor'
    default:
      return 'i-lucide-sun-medium'
  }
}

export function themeTitle(theme: AppTheme, copy: LocalizedCopy): string {
  switch (theme) {
    case 'dark':
      return copy.darkTheme
    case 'system':
      return copy.systemTheme
    default:
      return copy.lightTheme
  }
}

export function nextTheme(theme: AppTheme): AppTheme {
  switch (theme) {
    case 'light':
      return 'dark'
    case 'dark':
      return 'system'
    default:
      return 'light'
  }
}

export function extraLimits(
  usageByAccountId: Record<string, AccountRateLimits>,
  accountId: string
): AccountRateLimitEntry[] {
  const rateLimits = usageByAccountId[accountId]
  if (!rateLimits) {
    return []
  }

  return rateLimits.limits.filter((limit) => {
    if (limit.limitId === rateLimits.limitId) {
      return false
    }

    const raw = (limit.limitName ?? limit.limitId ?? '').toLowerCase()
    if (raw.includes('review')) {
      return false
    }

    return true
  })
}
