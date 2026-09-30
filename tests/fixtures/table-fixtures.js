/**
 * Test fixtures for table extraction, normalization, and hybrid query testing.
 * Realistic insurance policy table structures with zero emojis.
 */

const roomRentTable = {
  title: 'Room Rent and ICU Sub-Limits',
  pageNumber: 6,
  headers: ['Plan Category', 'Normal Room Rent Limit', 'ICU Charges Limit'],
  rows: [
    ['Silver', '1% of Sum Insured per day', '2% of Sum Insured per day'],
    ['Gold', 'Single Private AC Room', 'No sub-limit / Actuals'],
    ['Platinum', 'Any Room Category', 'No sub-limit / Actuals']
  ]
};

const waitingPeriodTable = {
  title: 'Waiting Periods Schedule',
  pageNumber: 12,
  headers: ['Coverage Type', 'Waiting Period', 'Applicable Conditions'],
  rows: [
    ['Initial Waiting Period', '30 Days', 'All illnesses except accidental injury'],
    ['Specific Illnesses', '24 Months', 'Cataract, Hernia, Joint Replacement'],
    ['Pre-Existing Diseases (PED)', '36 Months', 'Declared medical conditions prior to inception']
  ]
};

const copayTable = {
  title: 'Co-payment and Deductible Terms',
  pageNumber: 18,
  headers: ['Insured Age Band', 'Network Hospital Copay', 'Non-Network Hospital Copay'],
  rows: [
    ['Up to 60 Years', '0%', '10%'],
    ['61 to 70 Years', '10%', '20%'],
    ['Above 70 Years', '20%', '30%']
  ]
};

const sparseTable = {
  title: 'Day Care Surgeries List',
  pageNumber: 22,
  headers: ['Procedure Category'],
  rows: [
    ['Chemotherapy and Radiotherapy'],
    ['Hemodialysis']
  ]
};

const malformedTable = {
  title: 'Malformed Edge Case Table',
  pageNumber: 1,
  headers: ['Col A | Unescaped', 'Col B\nWith Newline', null],
  rows: [
    ['Val 1', 'Val 2 | pipe', 'Val 3'],
    ['Only one cell'],
    [null, undefined, 'Val 6']
  ]
};

module.exports = {
  roomRentTable,
  waitingPeriodTable,
  copayTable,
  sparseTable,
  malformedTable
};
