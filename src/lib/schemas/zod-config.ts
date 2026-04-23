import { z } from "zod"

// Global fallback error messages. Schema-level messages (e.g. `z.string().min(1, "Required")`)
// still win; this only fires when no explicit message was provided.
z.config({
  customError: (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        if (issue.input === undefined || issue.input === null || issue.input === "") {
          return "This field is required"
        }
        const expected = issue.expected
        if (expected === "number" || expected === "int" || expected === "bigint") {
          return "Please enter a valid number"
        }
        if (expected === "boolean") return "Please select a value"
        if (expected === "date") return "Please enter a valid date"
        if (expected === "string") return "Please enter a valid value"
        return "Please enter a valid value"
      }

      case "too_small": {
        const min = Number(issue.minimum)
        if (issue.origin === "string") {
          if (min <= 1 && issue.input === undefined) return "This field is required"
          if (min <= 1) return "This field is required"
          return `Must be at least ${min} characters`
        }
        if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
          return issue.inclusive ? `Must be at least ${min}` : `Must be greater than ${min}`
        }
        if (issue.origin === "array" || issue.origin === "set") {
          if (min <= 1) return "Please add at least one item"
          return `Please add at least ${min} items`
        }
        if (issue.origin === "date") return "Date is too early"
        if (issue.origin === "file") return "File is too small"
        return "Value is too small"
      }

      case "too_big": {
        const max = Number(issue.maximum)
        if (issue.origin === "string") return `Must be at most ${max} characters`
        if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
          return issue.inclusive ? `Must be at most ${max}` : `Must be less than ${max}`
        }
        if (issue.origin === "array" || issue.origin === "set") return `Please add at most ${max} items`
        if (issue.origin === "date") return "Date is too late"
        if (issue.origin === "file") return "File is too large"
        return "Value is too large"
      }

      case "invalid_format": {
        switch (issue.format) {
          case "email":
            return "Please enter a valid email address"
          case "url":
            return "Please enter a valid URL"
          case "uuid":
          case "cuid":
          case "cuid2":
          case "ulid":
          case "nanoid":
            return "Please select a valid option"
          case "date":
          case "datetime":
          case "time":
          case "iso_date":
          case "iso_datetime":
          case "iso_time":
            return "Please enter a valid date"
          case "regex":
            return "Invalid format"
          case "starts_with":
            return `Must start with "${(issue as { prefix?: string }).prefix ?? ""}"`
          case "ends_with":
            return `Must end with "${(issue as { suffix?: string }).suffix ?? ""}"`
          case "includes":
            return `Must include "${(issue as { includes?: string }).includes ?? ""}"`
          default:
            return "Invalid format"
        }
      }

      case "invalid_value":
        return "Please select a valid option"

      case "invalid_union":
        return "Please enter a valid value"

      case "not_multiple_of":
        return `Must be a multiple of ${issue.divisor}`

      case "unrecognized_keys":
        return "Some fields are not allowed"

      case "invalid_key":
        return "Invalid key"

      case "invalid_element":
        return "Invalid item"

      case "custom":
      default:
        return undefined
    }
  },
})
