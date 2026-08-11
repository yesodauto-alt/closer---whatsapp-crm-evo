import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/hooks/use-auth'
import { LanguageProvider } from '@/hooks/use-language'
import { IntegrationProvider } from '@/hooks/use-integration'

import Layout from './components/Layout'
import DashboardLayout from './components/DashboardLayout'
import Index from './pages/Index'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Contacts from './pages/Contacts'
import Pipeline from './pages/Pipeline'
import Settings from './pages/Settings'
import Chat from './pages/Chat'
import Agents from './pages/Agents'
import Products from './pages/Products'
import Teams from './pages/Teams'
import Channels from './pages/Channels'
import Priorities from './pages/Priorities'
import NotFound from './pages/NotFound'
import Onboarding from './pages/Onboarding'
import { ModulePage } from './pages/Workspace'

const App = () => (
  <LanguageProvider>
    <BrowserRouter>
      <AuthProvider>
        <IntegrationProvider>
          <TooltipProvider>
            <Sonner position="top-right" richColors />
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
              </Route>

              <Route path="/app" element={<DashboardLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="onboarding" element={<Onboarding />} />
                <Route path="pipeline" element={<Pipeline />} />
                <Route path="contacts" element={<Contacts mode="contacts" />} />
                <Route path="conversations" element={<Contacts mode="conversations" />} />
                <Route path="chat/:id" element={<Chat />} />
                <Route path="priorities" element={<Priorities />} />
                <Route path="channels" element={<Channels />} />
                <Route path="agents" element={<Agents />} />
                <Route path="products" element={<Products />} />
                <Route path="teams" element={<Teams />} />
                <Route path="support" element={<ModulePage title="Suporte" />} />
                <Route path="automations" element={<ModulePage title="Automações" />} />
                <Route path="templates" element={<ModulePage title="Templates" />} />
                <Route path="profile" element={<ModulePage title="Perfil" />} />
              </Route>

              <Route path="/settings" element={<DashboardLayout />}>
                <Route index element={<Settings />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </TooltipProvider>
        </IntegrationProvider>
      </AuthProvider>
    </BrowserRouter>
  </LanguageProvider>
)

export default App
