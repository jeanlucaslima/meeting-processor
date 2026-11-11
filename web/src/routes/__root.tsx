import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import { UploadProvider } from "@/components/upload";
import { useServerEvents } from "@/lib/events";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  useServerEvents();
  return (
    <UploadProvider>
      <div className="flex h-dvh flex-col">
        <AppHeader />
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </div>
    </UploadProvider>
  );
}
