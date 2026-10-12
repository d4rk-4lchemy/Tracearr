import { Outlet } from 'react-router';
import { isStaff } from '@tracearr/shared';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppSidebar } from './AppSidebar';
import { SiteHeader } from './SiteHeader';
import { StatusBanners } from './StatusBanners';
import { WhatsNewAutoOpen } from '@/components/whats-new/WhatsNewAutoOpen';
import { useAuth } from '@/hooks/useAuth';
import { useStreamCountTitle } from '@/hooks/useDocumentTitle';

export function Layout() {
  useStreamCountTitle();
  const { user } = useAuth();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <StatusBanners />
        {/* Release notes read and dismiss through settings routes a member cannot call, and
            a preview is read-only, so a dismiss would be refused and the dialog reopen */}
        {user && isStaff(user.role) && !user.impersonatedBy && <WhatsNewAutoOpen />}
        <ScrollArea className="flex-1">
          <main className="p-6">
            <Outlet />
          </main>
        </ScrollArea>
      </SidebarInset>
    </SidebarProvider>
  );
}
