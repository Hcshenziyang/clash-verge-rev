import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CustomUnlockTest } from '@/services/cmds'

type Props = {
  initial: CustomUnlockTest | null
  names: string[]
  onClose: () => void
  onSave: (test: CustomUnlockTest) => void
}

const emptyTest = (): CustomUnlockTest => ({
  name: '',
  url: '',
  expectedStatus: 200,
  bodyContains: '',
  regionPattern: '',
  hostHeader: '',
})

export const CustomUnlockEditor = ({
  initial,
  names,
  onClose,
  onSave,
}: Props) => {
  const { t } = useTranslation()
  const [test, setTest] = useState<CustomUnlockTest>(
    () => initial ?? emptyTest(),
  )
  const [error, setError] = useState('')
  const change = (patch: Partial<CustomUnlockTest>) =>
    setTest((current) => ({ ...current, ...patch }))

  const save = () => {
    const name = test.name.trim()
    const url = test.url.trim()
    if (
      !name ||
      names.some(
        (item) =>
          item.trim().toLowerCase() === name.toLowerCase() &&
          item !== initial?.name,
      )
    ) {
      setError(t('tests.unlock.custom.invalidName'))
      return
    }
    try {
      const parsed = new URL(url)
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        throw new Error('invalid URL')
    } catch {
      setError(t('tests.unlock.custom.invalidUrl'))
      return
    }
    if (
      !Number.isInteger(test.expectedStatus) ||
      test.expectedStatus < 100 ||
      test.expectedStatus > 599
    ) {
      setError(t('tests.unlock.custom.invalidStatus'))
      return
    }
    onSave({ ...test, name, url, hostHeader: test.hostHeader.trim() })
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t(
          initial
            ? 'tests.unlock.custom.editTitle'
            : 'tests.unlock.custom.addTitle',
        )}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">{t('tests.unlock.custom.explanation')}</Alert>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('shared.labels.name')}
            value={test.name}
            onChange={(event) => change({ name: event.target.value })}
            required
          />
          <TextField
            label={t('tests.unlock.custom.url')}
            value={test.url}
            onChange={(event) => change({ url: event.target.value })}
            required
            helperText={t('tests.unlock.custom.urlHelp')}
          />
          <TextField
            label={t('tests.unlock.custom.status')}
            type="number"
            value={Number.isNaN(test.expectedStatus) ? '' : test.expectedStatus}
            onChange={(event) =>
              change({
                expectedStatus: Number.parseInt(event.target.value, 10),
              })
            }
            required
          />
          <TextField
            label={t('tests.unlock.custom.bodyContains')}
            value={test.bodyContains}
            onChange={(event) => change({ bodyContains: event.target.value })}
          />
          <TextField
            label={t('tests.unlock.custom.regionPattern')}
            value={test.regionPattern}
            onChange={(event) => change({ regionPattern: event.target.value })}
            helperText={t('tests.unlock.custom.regionHelp')}
          />
          <TextField
            label={t('tests.unlock.custom.hostHeader')}
            value={test.hostHeader}
            onChange={(event) => change({ hostHeader: event.target.value })}
            helperText={t('tests.unlock.custom.hostHelp')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('shared.actions.cancel')}</Button>
        <Button variant="contained" onClick={save}>
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
