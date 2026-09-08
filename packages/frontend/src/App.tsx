import { Routes, Route, useParams } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import HomeView from "@/views/HomeView";
import ProjectView from "@/views/ProjectView";
import DesignSystemView from "@/views/DesignSystemView";
import SettingsView from "@/views/SettingsView";
import SettingsModal from "@/components/settings/SettingsModal";
import ToastContainer from "@/components/errors/BackendCrashToast";
import { useTheme } from "@/hooks/useTheme";

export default function App() {
  useTheme();
  return (
    <>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomeView />} />
          <Route path="/projects/:id" element={<ProjectRoute />} />
          <Route path="/systems/:id" element={<DesignSystemView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Routes>
      </AppShell>
      <SettingsModal />
      <ToastContainer />
    </>
  );
}

function ProjectRoute() {
  const { id } = useParams();
  return <ProjectView key={id} />;
}
