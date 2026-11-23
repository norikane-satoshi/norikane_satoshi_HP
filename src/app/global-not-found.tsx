import NotFound from 'next/dist/client/components/builtin/not-found'
import SiteLayout from '@/lib/i18n/site-layout'

export default function GlobalNotFound() {
  return <SiteLayout><NotFound /></SiteLayout>
}
