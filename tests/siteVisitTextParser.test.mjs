import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSiteVisitTextLocally } from '../src/utils/siteVisitTextParser.ts'

const baseDate = new Date(2026, 6, 7, 9, 0, 0)

test('extracts full site visit details including date, time, and job id', () => {
  const result = parseSiteVisitTextLocally(
    `
    Customer name: Jane Smith
    Phone: 021 123 4567
    Email: jane@example.com
    Address: 42 Queen Street, Auckland
    Job ID: JOB-1045
    Please book the site visit tomorrow at 3pm.
    Access notes: gate code 1234, use rear entry.
    `,
    baseDate,
  )

  assert.equal(result.customerName, 'Jane Smith')
  assert.equal(result.phone, '021 123 4567')
  assert.equal(result.email, 'jane@example.com')
  assert.equal(result.address, '42 Queen Street, Auckland')
  assert.equal(result.jobId, 'JOB-1045')
  assert.equal(result.preferredDate, '2026-07-08')
  assert.equal(result.preferredTime, '15:00')
  assert.match(result.notes ?? '', /gate code 1234/)
})

test('leaves date and time blank when no date or time is present', () => {
  const result = parseSiteVisitTextLocally(
    `
    Name: Morgan Lee
    Mobile: 027 555 019
    Location: Takapuna
    Notes: customer wants a site visit.
    `,
    baseDate,
  )

  assert.equal(result.customerName, 'Morgan Lee')
  assert.equal(result.preferredDate, null)
  assert.equal(result.preferredTime, null)
})

test('fills clear date but leaves vague time blank', () => {
  const result = parseSiteVisitTextLocally('Ref: INQ-77. Can we do next Friday morning? Access: lift available.', baseDate)

  assert.equal(result.jobId, 'INQ-77')
  assert.equal(result.preferredDate, '2026-07-10')
  assert.equal(result.preferredTime, null)
  assert.match(result.notes ?? '', /next Friday morning/i)
})

test('extracts explicit day and month with time', () => {
  const result = parseSiteVisitTextLocally('Wednesday 8 July at 3:30pm with Priya. Booking ID BK-9.', baseDate)

  assert.equal(result.jobId, 'BK-9')
  assert.equal(result.preferredDate, '2026-07-08')
  assert.equal(result.preferredTime, '15:30')
})

test('extracts numeric date and time', () => {
  const result = parseSiteVisitTextLocally('Site visit 7/7/2026 2pm. Reference REF-2026-7.', baseDate)

  assert.equal(result.jobId, 'REF-2026-7')
  assert.equal(result.preferredDate, '2026-07-07')
  assert.equal(result.preferredTime, '14:00')
})

test('prioritizes sales notes site visit over move date and requested move window', () => {
  const result = parseSiteVisitTextLocally(
    `Job ID: 110346
First Name*:
Lynne
Surname*:
Scott
Email*:
lscott@xtra.co.nz
Phone*:
0212043280
Move Date:
Saturday, 10 Oct, 2026
Time (requested):
8am-12pm
Pick Up Address*:
90 Weatherly Road, Torbay, Auckland, New Zealand
Delivery Address*:
20 Portstone Ave, Warkworth, New Zealand
Client Notes:
Please could someone call me and come out to my premises, to give me a clear indication of cost.
Sales Notes:
site visit booked Tuesday 7 July 9:30 am`,
    baseDate,
  )

  assert.equal(result.customerName, 'Lynne Scott')
  assert.equal(result.email, 'lscott@xtra.co.nz')
  assert.equal(result.phone, '0212043280')
  assert.equal(result.address, '90 Weatherly Road, Torbay, Auckland, New Zealand')
  assert.equal(result.preferredDate, '2026-07-07')
  assert.equal(result.preferredTime, '09:30')
  assert.equal(result.jobId, '110346')
  assert.notEqual(result.notes, 'No')
  assert.match(result.notes ?? '', /Please could someone call me/)
  assert.match(result.notes ?? '', /site visit booked Tuesday 7 July 9:30 am/)
})

test('extracts job id only without inventing schedule fields', () => {
  const result = parseSiteVisitTextLocally('Inquiry ID: INQ-9007', baseDate)

  assert.equal(result.jobId, 'INQ-9007')
  assert.equal(result.preferredDate, null)
  assert.equal(result.preferredTime, null)
})

test('returns an empty result for empty input', () => {
  const result = parseSiteVisitTextLocally('', baseDate)

  assert.equal(result.confidence, 0)
  assert.equal(result.preferredDate, null)
  assert.equal(result.preferredTime, null)
})
