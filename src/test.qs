namespace QsphereTest {
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Math;

    @EntryPoint()
    operation Main() : Unit {
        use q = Qubit[3];
        H(q[0]);

        ResetAll(q);
    }
}
