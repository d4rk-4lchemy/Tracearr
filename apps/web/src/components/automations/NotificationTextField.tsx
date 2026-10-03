import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces } from 'lucide-react';
import type { TemplateVariable } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { variableGroup, type VariableGroup } from '@/lib/automations';
import { cn } from '@/lib/utils';

interface NotificationTextFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  variables: readonly TemplateVariable[];
  multiline: boolean;
  maxLength: number;
  invalid?: boolean;
  'aria-labelledby'?: string;
}

/**
 * Where a chosen variable goes: the selection when the button opened the list, or the
 * `{{` the reader typed through the caret, with focus left in the field.
 */
interface Insertion {
  start: number;
  end: number;
  typed: boolean;
}

const TYPED_RUN = /^\{\{[\w.]*$/;

const inRun = (text: string, start: number, caret: number) =>
  caret >= start + 2 && TYPED_RUN.test(text.slice(start, caret));

/** cmdk gives each option its own generated id; the name is only on `data-value`. */
const optionFor = (list: HTMLElement | null, name: string) =>
  list?.querySelector<HTMLElement>(`[cmdk-item][data-value="${name}"]`);

export function NotificationTextField({
  id,
  value,
  onChange,
  variables,
  multiline,
  maxLength,
  invalid,
  'aria-labelledby': labelledBy,
}: NotificationTextFieldProps) {
  const { t } = useTranslation('pages');
  const box = useRef<HTMLTextAreaElement>(null);
  const [insertion, setInsertion] = useState<Insertion | null>(null);
  const [highlight, setHighlight] = useState('');
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const caretAfterChoice = useRef<number | null>(null);

  // Runs once the chosen token is in the textarea's value, before the next keystroke.
  useLayoutEffect(() => {
    const caret = caretAfterChoice.current;
    if (caret === null) return;
    caretAfterChoice.current = null;
    box.current?.focus();
    box.current?.setSelectionRange(caret, caret);
  });

  const typed = insertion?.typed === true;
  const query = typed ? value.slice(insertion.start + 2, insertion.end).toLowerCase() : '';
  const shown = typed
    ? variables.filter((name) => {
        const lower = name.toLowerCase();
        return lower.startsWith(query) || lower.includes(`.${query}`);
      })
    : variables;

  const groups = new Map<VariableGroup, TemplateVariable[]>();
  for (const name of shown) {
    const group = variableGroup(name);
    groups.set(group, [...(groups.get(group) ?? []), name]);
  }
  const ordered = [...groups.values()].flat();
  const active = ordered.find((name) => name === highlight) ?? ordered[0];

  const open = (next: Insertion) => {
    if (insertion === null) setHighlight('');
    setInsertion(next);
  };

  const openAtSelection = () => {
    const el = box.current;
    open({
      start: el?.selectionStart ?? value.length,
      end: el?.selectionEnd ?? value.length,
      typed: false,
    });
  };

  const choose = (name: TemplateVariable) => {
    if (!insertion) return;
    const token = `{{ ${name} }}`;
    onChange(value.slice(0, insertion.start) + token + value.slice(insertion.end));
    setInsertion(null);
    caretAfterChoice.current = insertion.start + token.length;
  };

  return (
    <div className="space-y-1.5">
      <Popover open={insertion !== null} onOpenChange={(next) => !next && setInsertion(null)}>
        <PopoverAnchor asChild>
          <Textarea
            ref={box}
            id={id}
            // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- a multi-line field has no native combobox element
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={typed}
            aria-controls={typed ? list?.id : undefined}
            aria-activedescendant={typed && active ? optionFor(list, active)?.id : undefined}
            aria-labelledby={labelledBy}
            aria-invalid={invalid || undefined}
            value={value}
            maxLength={maxLength}
            rows={multiline ? 3 : 1}
            className={cn('font-mono text-sm', !multiline && 'min-h-9')}
            onKeyDown={(event) => {
              if (!typed || active === undefined || event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                choose(active);
                return;
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              const at = Math.min(Math.max(ordered.indexOf(active) + step, 0), ordered.length - 1);
              const next = ordered[at];
              if (next === undefined) return;
              setHighlight(next);
              optionFor(list, next)?.scrollIntoView({ block: 'nearest' });
            }}
            onChange={(event) => {
              const raw = event.target.value;
              const next = multiline ? raw : raw.replace(/\r?\n/g, ' ');
              onChange(next);
              const caret = event.target.selectionStart;
              if (insertion?.typed && inRun(next, insertion.start, caret)) {
                setInsertion({ ...insertion, end: caret });
              } else if (next.slice(caret - 2, caret) === '{{') {
                open({ start: caret - 2, end: caret, typed: true });
              } else if (insertion?.typed) {
                setInsertion(null);
              }
            }}
            onSelect={(event) => {
              if (!insertion?.typed) return;
              const { selectionStart, selectionEnd, value: text } = event.currentTarget;
              if (
                selectionStart !== selectionEnd ||
                !inRun(text, insertion.start, selectionStart)
              ) {
                setInsertion(null);
              } else if (selectionStart !== insertion.end) {
                setInsertion({ ...insertion, end: selectionStart });
              }
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-72 p-0"
          onOpenAutoFocus={(event) => {
            if (typed) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const focused = document.activeElement;
            if (focused === null || focused === document.body) box.current?.focus();
          }}
        >
          <Command
            value={typed ? (active ?? '') : undefined}
            onValueChange={setHighlight}
            shouldFilter={!typed}
          >
            {!typed && <CommandInput placeholder={t('automations.message.searchVariables')} />}
            <CommandList ref={setList}>
              <CommandEmpty>{t('automations.message.noVariables')}</CommandEmpty>
              {[...groups].map(([group, names]) => (
                <CommandGroup key={group} heading={t(`automations.variableGroups.${group}`)}>
                  {names.map((name) => (
                    <CommandItem key={name} value={name} onSelect={() => choose(name)}>
                      <span className="font-mono text-xs">{name}</span>
                      <span className="text-muted-foreground ml-auto text-xs">
                        {t(`automations.variables.${name}`)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {multiline && (
        <Button type="button" variant="outline" size="sm" onClick={openAtSelection}>
          <Braces />
          {t('automations.message.insertVariable')}
        </Button>
      )}
    </div>
  );
}
