from qiskit import QuantumCircuit
import numpy as np

# Initialize a 3-qubit quantum circuit
qc = QuantumCircuit(3)

# Create GHZ entangled state: (|000> + |111>) / sqrt(2)
qc.h(0)
qc.cx(0, 1)
qc.cx(1, 2)

# Apply phase rotation
qc.rz(np.pi / 4, 0)
