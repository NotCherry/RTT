import pytest
from pydantic import ValidationError
from app.schemas import Demonstration


@pytest.mark.parametrize("version", [1, 2, 3])
def test_camera_demonstration_accepts_supported_mapping_versions(version):
    demo = Demonstration(current=[0], target=[0], source="camera", retargeting_profile_version=version)
    assert demo.retargeting_profile_version == version


def test_camera_demonstration_rejects_unknown_mapping_version():
    with pytest.raises(ValidationError):
        Demonstration(current=[0], target=[0], retargeting_profile_version=4)
