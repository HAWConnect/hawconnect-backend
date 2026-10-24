import * as appAnnouncements from '@/db/schema/appAnnouncements'
import * as auditLog from '@/db/schema/auditLog'
import * as manualClEvents from '@/db/schema/manualClEvents'
import * as roomReports from '@/db/schema/roomReports'
import { deleteManualClEvent } from '@/mutations/manual-cl-events/delete'

export default {
    ...appAnnouncements,
    ...roomReports,
    ...manualClEvents,
    ...auditLog,
    ...deleteManualClEvent
}
