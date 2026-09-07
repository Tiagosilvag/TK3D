import { redirect } from 'next/navigation'

// Middleware already redirects unauthenticated requests to /login for every
// route except /login itself, so by the time this page renders the user is
// authenticated — send them straight to the dashboard, the app's landing
// screen.
export default function Home() {
  redirect('/dashboard')
}
