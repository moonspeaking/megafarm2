import sys, idapro
idapro.enable_console_messages(False)
path = sys.argv[1]
start = int(sys.argv[2], 0)
end = int(sys.argv[3], 0)
idapro.open_database(path, True)
import ida_ua, idc
ea = start
while ea < end:
    print(hex(ea), idc.GetDisasm(ea) if hasattr(idc, "GetDisasm") else idc.generate_disasm_line(ea, 0))
    ea = idc.next_head(ea, end)
idapro.close_database(False)
