/** `numeric` arrives as a string; it is only converted to a number to display it. */
export const money = (value: string | number, currency: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(Number(value));

export const dateTime = (value: Date | string, timeZone: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
