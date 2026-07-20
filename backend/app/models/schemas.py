from pydantic import BaseModel


class MasterReport(BaseModel):
    measured_lufs_before_normalization: float
    target_lufs: float
    final_integrated_lufs: float
    final_true_peak_dbtp: float
    anti_ai_intensity: float
