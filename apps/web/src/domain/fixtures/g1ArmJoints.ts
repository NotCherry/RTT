import type { Joint } from "@/types";
// Joint transforms copied from the bundled G1 EDU source URDF; retain its rest-frame conventions.
export const g1ArmJoints: Joint[] = [
  {
    "name": "left_shoulder_pitch_joint",
    "type": "revolute",
    "parent": "torso_link",
    "child": "left_shoulder_pitch_link",
    "origin": {
      "xyz": [
        0.0039563,
        0.10022,
        0.24778
      ],
      "rpy": [
        0.27931,
        5.4949e-05,
        -0.00019159
      ]
    },
    "axis": [
      0.0,
      1.0,
      0.0
    ],
    "lower": -3.0892,
    "upper": 2.6704,
    "controllable": true
  },
  {
    "name": "left_shoulder_roll_joint",
    "type": "revolute",
    "parent": "left_shoulder_pitch_link",
    "child": "left_shoulder_roll_link",
    "origin": {
      "xyz": [
        0.0,
        0.038,
        -0.013831
      ],
      "rpy": [
        -0.27925,
        0.0,
        0.0
      ]
    },
    "axis": [
      1.0,
      0.0,
      0.0
    ],
    "lower": -1.5882,
    "upper": 2.2515,
    "controllable": true
  },
  {
    "name": "left_shoulder_yaw_joint",
    "type": "revolute",
    "parent": "left_shoulder_roll_link",
    "child": "left_shoulder_yaw_link",
    "origin": {
      "xyz": [
        0.0,
        0.00624,
        -0.1032
      ],
      "rpy": [
        0.0,
        0.0,
        0.0
      ]
    },
    "axis": [
      0.0,
      0.0,
      1.0
    ],
    "lower": -2.618,
    "upper": 2.618,
    "controllable": true
  },
  {
    "name": "left_elbow_joint",
    "type": "revolute",
    "parent": "left_shoulder_yaw_link",
    "child": "left_elbow_link",
    "origin": {
      "xyz": [
        0.015783,
        0.0,
        -0.080518
      ],
      "rpy": [
        0.0,
        0.0,
        0.0
      ]
    },
    "axis": [
      0.0,
      1.0,
      0.0
    ],
    "lower": -1.0472,
    "upper": 2.0944,
    "controllable": true
  },
  {
    "name": "left_wrist_roll_joint",
    "type": "revolute",
    "parent": "left_elbow_link",
    "child": "left_wrist_roll_link",
    "origin": {
      "xyz": [
        0.1,
        0.00188791,
        -0.01
      ],
      "rpy": [
        0.0,
        0.0,
        0.0
      ]
    },
    "axis": [
      1.0,
      0.0,
      0.0
    ],
    "lower": -1.972222054,
    "upper": 1.972222054,
    "controllable": true
  },
  {
    "name": "right_shoulder_pitch_joint",
    "type": "revolute",
    "parent": "torso_link",
    "child": "right_shoulder_pitch_link",
    "origin": {
      "xyz": [
        0.0039563,
        -0.10021,
        0.24778
      ],
      "rpy": [
        -0.27931,
        5.4949e-05,
        0.00019159
      ]
    },
    "axis": [
      0.0,
      1.0,
      0.0
    ],
    "lower": -3.0892,
    "upper": 2.6704,
    "controllable": true
  },
  {
    "name": "right_shoulder_roll_joint",
    "type": "revolute",
    "parent": "right_shoulder_pitch_link",
    "child": "right_shoulder_roll_link",
    "origin": {
      "xyz": [
        0.0,
        -0.038,
        -0.013831
      ],
      "rpy": [
        0.27925,
        0.0,
        0.0
      ]
    },
    "axis": [
      1.0,
      0.0,
      0.0
    ],
    "lower": -2.2515,
    "upper": 1.5882,
    "controllable": true
  },
  {
    "name": "right_shoulder_yaw_joint",
    "type": "revolute",
    "parent": "right_shoulder_roll_link",
    "child": "right_shoulder_yaw_link",
    "origin": {
      "xyz": [
        0.0,
        -0.00624,
        -0.1032
      ],
      "rpy": [
        0.0,
        0.0,
        0.0
      ]
    },
    "axis": [
      0.0,
      0.0,
      1.0
    ],
    "lower": -2.618,
    "upper": 2.618,
    "controllable": true
  },
  {
    "name": "right_elbow_joint",
    "type": "revolute",
    "parent": "right_shoulder_yaw_link",
    "child": "right_elbow_link",
    "origin": {
      "xyz": [
        0.015783,
        0.0,
        -0.080518
      ],
      "rpy": [
        0.0,
        0.0,
        0.0
      ]
    },
    "axis": [
      0.0,
      1.0,
      0.0
    ],
    "lower": -1.0472,
    "upper": 2.0944,
    "controllable": true
  },
  {
    "name": "right_wrist_roll_joint",
    "type": "revolute",
    "parent": "right_elbow_link",
    "child": "right_wrist_roll_link",
    "origin": {
      "xyz": [
        0.1,
        -0.00188791,
        -0.01
      ],
      "rpy": [
        0.0,
        0.0,
        0.0
      ]
    },
    "axis": [
      1.0,
      0.0,
      0.0
    ],
    "lower": -1.972222054,
    "upper": 1.972222054,
    "controllable": true
  }
];
