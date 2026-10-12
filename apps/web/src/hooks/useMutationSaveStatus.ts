import { useEffect, useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { SaveStatus } from '@/hooks/useDebouncedSave';

const SAVED_VISIBLE_MS = 2000;

/** The autosave fields' status for a field that saves through a mutation instead of useDebouncedSave. */
export function useMutationSaveStatus(
  mutation: Pick<UseMutationResult, 'isPending' | 'isError' | 'isSuccess' | 'submittedAt'>
): SaveStatus {
  const { isPending, isError, isSuccess, submittedAt } = mutation;
  const [savedVisible, setSavedVisible] = useState(false);

  useEffect(() => {
    if (!isSuccess) return;
    setSavedVisible(true);
    const timer = setTimeout(() => setSavedVisible(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [isSuccess, submittedAt]);

  if (isPending) return 'saving';
  if (isError) return 'error';
  return isSuccess && savedVisible ? 'saved' : 'idle';
}
