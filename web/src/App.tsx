import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { AuthGate } from "./components/AuthGate.js";
import { BrowsePage } from "./pages/BrowsePage.js";
import { JobsPage } from "./pages/JobsPage.js";
import { MountsPage } from "./pages/MountsPage.js";
import { RemotesPage } from "./pages/RemotesPage.js";
import { ServePage } from "./pages/ServePage.js";
import { SchedulesPage } from "./pages/SchedulesPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        {(status) => (
          <AppShell unprotected={!status.protected}>
            <Routes>
              <Route path="/" element={<RemotesPage />} />
              <Route path="/browse" element={<BrowsePage />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/serve" element={<ServePage />} />
              <Route path="/mounts" element={<MountsPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </AppShell>
        )}
      </AuthGate>
    </BrowserRouter>
  );
}
