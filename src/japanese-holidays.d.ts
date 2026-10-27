declare module 'japanese-holidays' {
  const JapaneseHolidays: { isHoliday(date: Date, furikae?: boolean): string | undefined }
  export default JapaneseHolidays
}
