"""Route external read-only apps to dedicated MySQL databases."""

MBM_AUTOMATION_APP = "mbm_automation"
CUTTINGEDGE_MODELS = {"hrasbasicinfo", "hrdesignation"}


class ExternalDbRouter:
    def db_for_read(self, model, **hints):
        if model._meta.model_name in CUTTINGEDGE_MODELS:
            return "cuttingedge"
        if model._meta.app_label == MBM_AUTOMATION_APP and model._meta.model_name not in CUTTINGEDGE_MODELS:
            return "mbm_automation"
        return None

    def db_for_write(self, model, **hints):
        return self.db_for_read(model, **hints)

    def allow_relation(self, obj1, obj2, **hints):
        labels = {obj1._meta.app_label, obj2._meta.app_label}
        if MBM_AUTOMATION_APP in labels:
            return labels == {MBM_AUTOMATION_APP}
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if db in ("mbm_automation", "cuttingedge") or app_label == MBM_AUTOMATION_APP:
            return False
        return None
