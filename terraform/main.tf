provider "kubernetes" {
  config_path = "~/.kube/config"
  config_context = "homepi"
}

provider "helm" {
  kubernetes = {
    config_path = "~/.kube/config"
    config_context = "homepi"
  }
}

terraform {
  required_providers {
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
  }
}


resource "kubernetes_namespace" "mesician_namespace" {
  metadata {
    name = "mesician"
  }
}


# mesician
module "mesician" {
  source    = "./modules/helm_release"
  chart_id = "mesician"
}
resource "helm_release" "mesician_helm_release" {
  chart     = module.mesician.chart_path
  name      = module.mesician.chart_id
  namespace   = kubernetes_namespace.mesician_namespace.metadata[0].name

  set = [
    {
      name  = "chart-hash"
      value = module.mesician.chart_hash
    }
  ]

  depends_on = [
    kubernetes_namespace.mesician_namespace
  ]
}