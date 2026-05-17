# https://github.com/hashicorp/terraform-provider-helm/issues/372#issuecomment-1042812174
locals {

  chart_path = "../k8s/${var.chart_id}"
  # This hash forces Terraform to redeploy if a new template file is added or changed, or values are updated
  chart_hash = sha1(join("", [for f in fileset(local.chart_path, "**/*.yaml"): filesha1("${local.chart_path}/${f}")]))
}

# Generic resource
# resource "helm_release" "generic_helm_release" {
#   chart     = local.chart_path
#   name      = var.chart_id
#
#   timeout   = var.timeout
#
#   # Setting chart hash (tracks changes)
#   set {
#     name  = "chart-hash"
#     value = local.chart_hash
#   }
# }

output "chart_id" {
  value = var.chart_id
}

output "chart_path" {
  value = local.chart_path
}

output "chart_hash" {
  value = local.chart_hash
}