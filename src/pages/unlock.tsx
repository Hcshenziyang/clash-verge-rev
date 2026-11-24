import {
  AccessTimeOutlined,
  AddRounded,
  CancelOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  HelpOutlined,
  PendingOutlined,
  RefreshRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { Channel } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseEmpty, BasePage } from '@/components/base'
import { CustomUnlockEditor } from '@/components/test/custom-unlock-editor'
import {
  checkCustomUnlockItem,
  checkMediaUnlock,
  checkMediaUnlockItem,
  getUnlockItems,
  type UnlockItem,
  type CustomUnlockTest,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const UNLOCK_RESULTS_STORAGE_KEY = 'clash_verge_unlock_results'
const CUSTOM_TESTS_STORAGE_KEY = 'clash_verge_custom_unlock_tests'

type DisplayUnlockItem = UnlockItem & {
  http_status?: number | null
  error?: string | null
}

const CUSTOM_TEST_PRESETS: CustomUnlockTest[] = [
  ['Antigravity AICode (Region estimate)', 'aicode.googleapis.com'],
  [
    'Antigravity CloudCode (Region estimate)',
    'daily-cloudcode-pa.googleapis.com',
  ],
].map(([name, host]) => ({
  name,
  url: `https://${host}/terms?hl=en`,
  expectedStatus: 200,
  bodyContains: 'Country version:',
  regionPattern: 'Country version:</a>\\s*([^<]+)',
  hostHeader: 'policies.google.com',
}))

const loadCustomTests = (): CustomUnlockTest[] => {
  try {
    const saved = localStorage.getItem(CUSTOM_TESTS_STORAGE_KEY)
    if (saved === null) return CUSTOM_TEST_PRESETS
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) ? (parsed as CustomUnlockTest[]) : []
  } catch {
    return []
  }
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  Pending: 'tests.statuses.test.pending',
  Yes: 'tests.statuses.test.yes',
  No: 'tests.statuses.test.no',
  Failed: 'tests.statuses.test.failed',
  Risky: 'tests.statuses.test.risky',
  Completed: 'tests.statuses.test.completed',
  'Disallowed ISP': 'tests.statuses.test.disallowedIsp',
  'Originals Only': 'tests.statuses.test.originalsOnly',
  'No (IP Banned By Disney+)': 'tests.statuses.test.noDisney',
  'Unsupported Country/Region': 'tests.statuses.test.unsupportedRegion',
  'Failed (Network Connection)': 'tests.statuses.test.failedNetwork',
  Matched: 'tests.unlock.custom.matched',
  Mismatch: 'tests.unlock.custom.mismatch',
}

const CUSTOM_ERROR_KEYS: Record<string, string> = {
  invalidUrl: 'tests.unlock.custom.errors.invalidUrl',
  invalidUrlOrStatus: 'tests.unlock.custom.errors.invalidUrlOrStatus',
  invalidPattern: 'tests.unlock.custom.errors.invalidPattern',
  invalidHost: 'tests.unlock.custom.errors.invalidHost',
  requestFailed: 'tests.unlock.custom.errors.requestFailed',
  timeout: 'tests.unlock.custom.errors.timeout',
  bodyTooLarge: 'tests.unlock.custom.errors.bodyTooLarge',
  responseFailed: 'tests.unlock.custom.errors.responseFailed',
}

const normalizeUnlockName = (name: string) => name.trim().toLowerCase()

const getStatusPriority = (status: string) => (status === 'Pending' ? 0 : 1)
const mergeOptionalFields = (preferred: UnlockItem, fallback: UnlockItem) => ({
  ...preferred,
  region: preferred.region ?? fallback.region,
  check_time: preferred.check_time ?? fallback.check_time,
})

const dedupeUnlockItems = (items: DisplayUnlockItem[]) => {
  const map = new Map<string, DisplayUnlockItem>()

  items.forEach((item) => {
    const key = normalizeUnlockName(item.name)
    const existing = map.get(key)

    if (!existing) {
      map.set(key, item)
      return
    }

    const existingPriority = getStatusPriority(existing.status)
    const itemPriority = getStatusPriority(item.status)

    if (itemPriority > existingPriority) {
      map.set(key, mergeOptionalFields(item, existing))
      return
    }

    if (itemPriority < existingPriority) {
      map.set(key, mergeOptionalFields(existing, item))
      return
    }

    map.set(key, mergeOptionalFields(item, existing))
  })

  return Array.from(map.values())
}

const UnlockPage = () => {
  const { t } = useTranslation()
  const theme = useTheme()

  const [unlockItems, setUnlockItems] = useState<DisplayUnlockItem[]>([])
  const unlockItemsRef = useRef<DisplayUnlockItem[]>([])
  const [customTests, setCustomTests] = useState(loadCustomTests)
  const [editingTest, setEditingTest] = useState<CustomUnlockTest | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [deletingTest, setDeletingTest] = useState<string | null>(null)
  const [isCheckingAll, setIsCheckingAll] = useState(false)
  const [loadingItems, setLoadingItems] = useState<string[]>([])

  const saveResultsToStorage = (items: DisplayUnlockItem[]) => {
    try {
      localStorage.setItem(UNLOCK_RESULTS_STORAGE_KEY, JSON.stringify(items))
    } catch (err) {
      console.error('Failed to save results to storage:', err)
    }
  }

  useEffect(() => {
    let storedItems: DisplayUnlockItem[] = []
    try {
      const itemsJson = localStorage.getItem(UNLOCK_RESULTS_STORAGE_KEY)
      if (itemsJson) {
        storedItems = dedupeUnlockItems(
          JSON.parse(itemsJson) as DisplayUnlockItem[],
        )
      }
    } catch (err) {
      console.error('Failed to load results from storage:', err)
    }

    void (async () => {
      try {
        const defaultItems = await getUnlockItems()
        const existingMap = new Map(
          storedItems.map((item) => [normalizeUnlockName(item.name), item]),
        )
        const customItems = loadCustomTests().map((test) => ({
          name: test.name,
          status: 'Pending',
          region: null,
          check_time: null,
        }))
        const mergedItems = [...defaultItems, ...customItems].map((item) => {
          const matchedItem = existingMap.get(normalizeUnlockName(item.name))
          return matchedItem ? { ...matchedItem, name: item.name } : item
        })

        const sortedItems = mergedItems.sort((a, b) =>
          a.name.localeCompare(b.name),
        )
        unlockItemsRef.current = sortedItems
        setUnlockItems(sortedItems)
      } catch (err: any) {
        console.error('Failed to get unlock items:', err)
      }
    })()
  }, [])

  const updateResult = (result: DisplayUnlockItem) => {
    const updatedItems = unlockItemsRef.current.map((item) =>
      item.name === result.name ? result : item,
    )
    unlockItemsRef.current = updatedItems
    setUnlockItems(updatedItems)
    setLoadingItems((items) => items.filter((name) => name !== result.name))
  }

  const saveCustomTests = (tests: CustomUnlockTest[]) => {
    localStorage.setItem(CUSTOM_TESTS_STORAGE_KEY, JSON.stringify(tests))
    setCustomTests(tests)
  }

  const saveCustomTest = (test: CustomUnlockTest) => {
    const updatedTests = editingTest
      ? customTests.map((item) =>
          item.name === editingTest.name ? test : item,
        )
      : [...customTests, test]
    const pending: DisplayUnlockItem = {
      name: test.name,
      status: 'Pending',
      region: null,
      check_time: null,
    }
    const updatedItems = editingTest
      ? unlockItemsRef.current.map((item) =>
          item.name === editingTest.name ? pending : item,
        )
      : [...unlockItemsRef.current, pending]
    updatedItems.sort((a, b) => a.name.localeCompare(b.name))
    saveCustomTests(updatedTests)
    unlockItemsRef.current = updatedItems
    setUnlockItems(updatedItems)
    saveResultsToStorage(updatedItems)
    setEditorOpen(false)
  }

  const deleteCustomTest = (name: string) => {
    saveCustomTests(customTests.filter((item) => item.name !== name))
    const updatedItems = unlockItemsRef.current.filter(
      (item) => item.name !== name,
    )
    unlockItemsRef.current = updatedItems
    setUnlockItems(updatedItems)
    saveResultsToStorage(updatedItems)
    setDeletingTest(null)
  }

  // 执行全部项目检测
  const checkAllMedia = useLockFn(async () => {
    const onComplete = new Channel<UnlockItem>(updateResult)

    try {
      setIsCheckingAll(true)
      setLoadingItems(unlockItems.map((item) => item.name))
      const runCustomTests = async () => {
        const queue = [...customTests]
        await Promise.all(
          Array.from({ length: Math.min(queue.length, 4) }, async () => {
            let test: CustomUnlockTest | undefined
            while ((test = queue.shift())) {
              try {
                updateResult(await checkCustomUnlockItem(test))
              } catch {
                updateResult({
                  name: test.name,
                  status: 'Failed',
                  region: null,
                  check_time: null,
                })
              }
            }
          }),
        )
      }
      const [builtins] = await Promise.allSettled([
        checkMediaUnlock(onComplete),
        runCustomTests(),
      ])
      if (builtins.status === 'fulfilled') builtins.value.forEach(updateResult)
      saveResultsToStorage(unlockItemsRef.current)
      if (builtins.status === 'rejected') throw builtins.reason
    } catch (err: any) {
      showNotice.error('tests.unlock.page.messages.detectionTimeout', err)
      console.error('Failed to check media unlock:', err)
    } finally {
      setLoadingItems([])
      setIsCheckingAll(false)
    }
  })

  // 检测单个流媒体服务
  const checkSingleMedia = async (name: string) => {
    setLoadingItems((items) => [...items, name])
    try {
      const customTest = customTests.find((test) => test.name === name)
      const result = customTest
        ? await checkCustomUnlockItem(customTest)
        : await checkMediaUnlockItem(name)
      const updatedItems = unlockItemsRef.current.map((item) =>
        item.name === name ? result : item,
      )

      unlockItemsRef.current = updatedItems
      setUnlockItems(updatedItems)
      saveResultsToStorage(updatedItems)
    } catch (err: any) {
      showNotice.error(
        'tests.unlock.page.messages.detectionFailedWithName',
        { name },
        err,
      )
      console.error(`Failed to check ${name}:`, err)
    } finally {
      setLoadingItems((items) => items.filter((item) => item !== name))
    }
  }

  // 状态颜色
  const getStatusColor = (status: string) => {
    if (status === 'Pending') return 'default'
    if (status === 'Yes') return 'success'
    if (status === 'Matched') return 'success'
    if (status === 'Mismatch') return 'warning'
    if (status === 'No') return 'error'
    if (status === 'Soon' || status === 'Risky') return 'warning'
    if (status.includes('Failed')) return 'error'
    if (status === 'Completed') return 'info'
    if (
      status === 'Disallowed ISP' ||
      status === 'Blocked' ||
      status === 'Unsupported Country/Region'
    ) {
      return 'error'
    }
    return 'default'
  }

  // 状态图标
  const getStatusIcon = (status: string) => {
    if (status === 'Pending') return <PendingOutlined />
    if (status === 'Yes') return <CheckCircleOutlined />
    if (status === 'Matched') return <CheckCircleOutlined />
    if (status === 'Mismatch') return <HelpOutlined />
    if (status === 'No') return <CancelOutlined />
    if (status === 'Soon') return <AccessTimeOutlined />
    return <HelpOutlined />
  }

  // 边框色
  const getStatusBorderColor = (status: string) => {
    if (status === 'Yes') return theme.palette.success.main
    if (status === 'Matched') return theme.palette.success.main
    if (status === 'Mismatch') return theme.palette.warning.main
    if (status === 'No') return theme.palette.error.main
    if (status === 'Soon' || status === 'Risky')
      return theme.palette.warning.main
    if (status.includes('Failed')) return theme.palette.error.main
    if (status === 'Completed') return theme.palette.info.main
    return theme.palette.divider
  }

  const isDark = theme.palette.mode === 'dark'

  return (
    <BasePage
      title={t('tests.unlock.page.title')}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddRounded />}
            disabled={isCheckingAll || loadingItems.length > 0}
            onClick={() => {
              setEditingTest(null)
              setEditorOpen(true)
            }}
          >
            {t('tests.unlock.custom.add')}
          </Button>
          <Button
            variant="contained"
            size="small"
            disabled={
              unlockItems.length === 0 ||
              isCheckingAll ||
              loadingItems.length > 0
            }
            onClick={checkAllMedia}
            startIcon={
              isCheckingAll ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <RefreshRounded />
              )
            }
          >
            {isCheckingAll
              ? t('tests.unlock.page.actions.testing')
              : t('tests.page.actions.testAll')}
          </Button>
        </Box>
      }
    >
      {unlockItems.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '50%',
          }}
        >
          <BaseEmpty textKey="tests.unlock.page.empty" />
        </Box>
      ) : (
        <Grid container spacing={1.5} columns={{ xs: 1, sm: 2, md: 3 }}>
          {unlockItems.map((item) => (
            <Grid size={1} key={item.name}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  borderRadius: 2,
                  borderLeft: `4px solid ${getStatusBorderColor(item.status)}`,
                  backgroundColor: isDark ? '#282a36' : '#ffffff',
                  position: 'relative',
                  overflow: 'hidden',
                  '&:hover': {
                    backgroundColor: isDark
                      ? alpha(theme.palette.primary.dark, 0.05)
                      : alpha(theme.palette.primary.light, 0.05),
                  },
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Box sx={{ p: 1.3, flex: 1 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: 600,
                        fontSize: '1rem',
                        color: 'text.primary',
                      }}
                    >
                      {item.name}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      {customTests.some((test) => test.name === item.name) && (
                        <>
                          <Tooltip title={t('shared.actions.edit')}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={
                                  isCheckingAll || loadingItems.length > 0
                                }
                                onClick={() => {
                                  setEditingTest(
                                    customTests.find(
                                      (test) => test.name === item.name,
                                    ) ?? null,
                                  )
                                  setEditorOpen(true)
                                }}
                              >
                                <EditOutlined fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={t('shared.actions.delete')}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={
                                  isCheckingAll || loadingItems.length > 0
                                }
                                onClick={() => setDeletingTest(item.name)}
                              >
                                <DeleteOutlined fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip title={t('tests.components.item.actions.test')}>
                        <span>
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            disabled={
                              loadingItems.includes(item.name) || isCheckingAll
                            }
                            sx={{
                              minWidth: '32px',
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                            }}
                            onClick={() => checkSingleMedia(item.name)}
                          >
                            <RefreshRounded
                              sx={{
                                animation: loadingItems.includes(item.name)
                                  ? 'spin 1s linear infinite'
                                  : 'none',
                                '@keyframes spin': {
                                  '0%': { transform: 'rotate(0deg)' },
                                  '100%': { transform: 'rotate(360deg)' },
                                },
                              }}
                            />
                          </Button>
                        </span>
                      </Tooltip>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 1,
                    }}
                  >
                    <Chip
                      label={t(STATUS_LABEL_KEYS[item.status] ?? item.status)}
                      color={getStatusColor(item.status)}
                      size="small"
                      icon={getStatusIcon(item.status)}
                      sx={{
                        fontWeight:
                          item.status === 'Pending' ? 'normal' : 'bold',
                      }}
                    />

                    {item.region && (
                      <Chip
                        label={item.region}
                        size="small"
                        variant="outlined"
                        color="info"
                      />
                    )}
                    {item.http_status != null && (
                      <Chip
                        label={`HTTP ${item.http_status}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                  {customTests.some((test) => test.name === item.name) && (
                    <Typography variant="caption" color="text.secondary">
                      {t('tests.unlock.custom.resultHint')}
                    </Typography>
                  )}
                  {item.error && (
                    <Typography
                      variant="caption"
                      color="error"
                      sx={{ display: 'block' }}
                    >
                      {t(
                        CUSTOM_ERROR_KEYS[item.error] ??
                          CUSTOM_ERROR_KEYS.requestFailed,
                      )}
                    </Typography>
                  )}
                </Box>

                <Divider
                  sx={{
                    borderStyle: 'dashed',
                    borderColor: alpha(theme.palette.divider, 0.2),
                    mx: 1,
                  }}
                />

                <Box sx={{ px: 1.5, py: 0.2 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      color: 'text.secondary',
                      fontSize: '0.7rem',
                      textAlign: 'right',
                    }}
                  >
                    {item.check_time || '-- --'}
                  </Typography>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      {editorOpen && (
        <CustomUnlockEditor
          initial={editingTest}
          names={unlockItems.map((item) => item.name)}
          onClose={() => setEditorOpen(false)}
          onSave={saveCustomTest}
        />
      )}
      <Dialog
        open={deletingTest !== null}
        onClose={() => setDeletingTest(null)}
      >
        <DialogTitle>{t('shared.actions.delete')}</DialogTitle>
        <DialogContent>
          {t('tests.unlock.custom.confirmDelete', { name: deletingTest ?? '' })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingTest(null)}>
            {t('shared.actions.cancel')}
          </Button>
          <Button
            color="error"
            onClick={() => deletingTest && deleteCustomTest(deletingTest)}
          >
            {t('shared.actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </BasePage>
  )
}

export default UnlockPage
