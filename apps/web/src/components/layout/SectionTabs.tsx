import { NavLink, useLocation, useNavigate } from 'react-router';
import { withRangeParams } from '@/lib/rangeParams';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SectionTab {
  nameKey: string;
  label: string;
  href: string;
  count?: number;
  end?: boolean;
}

const TAB_LINK =
  'text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground inline-flex items-center gap-2 border-b-2 border-transparent px-0.5 pt-2.5 pb-3 text-sm font-medium whitespace-nowrap';

function pathOf(href: string): string {
  return href.split('?')[0] ?? href;
}

export function currentTab<T extends Pick<SectionTab, 'href' | 'end'>>(
  tabs: T[],
  pathname: string
): T | undefined {
  return tabs
    .filter((tab) => {
      const path = pathOf(tab.href);
      return pathname === path || (!tab.end && pathname.startsWith(path + '/'));
    })
    .sort((a, b) => pathOf(b.href).length - pathOf(a.href).length)[0];
}

export function SectionTabs({ tabs, ariaLabel }: { tabs: SectionTab[]; ariaLabel: string }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  if (tabs.length < 2) return null;

  return (
    <>
      <div className="pb-3 sm:hidden">
        <Select
          value={currentTab(tabs, pathname)?.href ?? ''}
          onValueChange={(href) => {
            void navigate(withRangeParams(href, search));
          }}
        >
          <SelectTrigger className="w-full" aria-label={ariaLabel}>
            <SelectValue placeholder={ariaLabel} />
          </SelectTrigger>
          <SelectContent>
            {tabs.map((tab) => (
              <SelectItem key={tab.nameKey} value={tab.href}>
                {tab.count !== undefined ? `${tab.label} (${tab.count})` : tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav aria-label={ariaLabel} className="-mb-px hidden gap-6 overflow-x-auto sm:flex">
        {tabs.map((tab) => (
          <NavLink
            key={tab.nameKey}
            to={withRangeParams(tab.href, search)}
            end={tab.end}
            className={TAB_LINK}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs tabular-nums">
                {tab.count}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
