import { expect, it } from 'bun:test'
import { clClubs } from '@/queries/clubs'
import getClEvents from '@/scraping/cl-event'

it('retired public feeds return no unrelated university data', async () => {
    expect(await getClEvents()).toEqual([])
    expect(await clClubs()).toEqual([])
})
