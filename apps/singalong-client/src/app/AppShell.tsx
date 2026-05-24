import { BrowserRouter } from 'react-router-dom'
import AppShellContent from './AppShellContent'

export default function AppShell() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppShellContent />
    </BrowserRouter>
  )
}
