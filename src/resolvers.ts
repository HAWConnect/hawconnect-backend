import { GraphQLScalarType, Kind } from 'graphql'
import {
    DateTimeResolver,
    EmailAddressResolver,
    LocalEndTimeResolver,
    URLResolver
} from 'graphql-scalars'
import { accountSnapshot, accountSync } from '@/queries/account-sync'
import { campusLifeEvents } from '@/queries/campus-life'
import { clEvents } from '@/queries/cl-events'
import { clClubs } from '@/queries/clubs'
import { food } from '@/queries/food'
import { hawEvents } from '@/queries/haw-events'
import { academicCalendarService } from '@/utils/academic-calendar'
import { hawClubs } from '@/utils/haw-clubs'

import { deleteAppAnnouncement } from './mutations/app-announcements/delete'
import { upsertAppAnnouncement } from './mutations/app-announcements/upsert'
import { deleteManualClEvent } from './mutations/manual-cl-events/delete'
import { upsertManualClEvent } from './mutations/manual-cl-events/upsert'
import { createRoomReport } from './mutations/room-reports/create'
import { resolveRoomReport } from './mutations/room-reports/resolve'
import { appAnnouncementsQuery } from './queries/appAnnouncements'
import { auditLogQuery } from './queries/auditLog'
import { careerServiceEvents } from './queries/careerService'
import { roomReportsQuery } from './queries/roomReports'
import { studentCounsellingEvents } from './queries/studentCounselling'

const LocationInput = new GraphQLScalarType({
    name: 'LocationInput',
    description:
        'Custom food input scalar type for handling both enum values and strings. This is used for the migration of the food query to the new schema.',
    parseValue(value) {
        return value // Value from the client input variables
    },
    serialize(value) {
        return value // Value sent to the client
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.STRING) {
            const value = ast.value
            return value // String value
        }
        if (ast.kind === Kind.ENUM) {
            return ast.value
        }

        throw new Error('LocationInput must be a string or a valid enum value')
    }
})

export const resolvers = {
    Query: {
        campusLifeEvents,
        hawEvents,
        academicCalendar: () => academicCalendarService.get(),
        accountSnapshot,
        food,
        clEvents,
        clClubs,
        careerServiceEvents,
        studentCounsellingEvents,
        appAnnouncements: appAnnouncementsQuery,
        announcements: appAnnouncementsQuery,
        hawClubs: (_: unknown, args: { language?: string }) =>
            hawClubs(args.language),
        roomReports: roomReportsQuery,
        auditLog: auditLogQuery
    },
    Mutation: {
        accountSync,
        deleteAppAnnouncement,
        upsertAppAnnouncement,
        createRoomReport,
        resolveRoomReport,
        upsertManualClEvent,
        deleteManualClEvent
    },
    CareerServiceEvent: {
        // Deprecated fields - always return null for backward compatibility
        unlimitedSlots: () => null,
        availableSlots: () => null,
        totalSlots: () => null,
        waitingList: () => null,
        maxWaitingList: () => null
    },
    LocalTime: LocalEndTimeResolver,
    DateTime: DateTimeResolver,
    EmailAddress: EmailAddressResolver,
    URL: URLResolver,
    LocationInput
}
