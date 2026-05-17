variable "chart_id" {
  type        = string
  description = "Chart identifier"
}

variable "timeout" {
  type        = number
  description = "Chart timeout"
  default     = 300
}