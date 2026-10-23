package com.pmp.app;

import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;

/** Populates the assignment dropdowns from real accounts rather than a hardcoded list. */
@RestController
@RequestMapping("/api")
public class DirectoryController {

    private final AccountRepository accounts;
    private final CurrentUser currentUser;
    private final RequestService requests;

    public DirectoryController(AccountRepository accounts, CurrentUser currentUser,
                               RequestService requests) {
        this.accounts = accounts;
        this.currentUser = currentUser;
        this.requests = requests;
    }

    @GetMapping("/technicians")
    public List<Dto.AccountView> technicians() {
        Account who = currentUser.require();
        currentUser.requireRole(who, Role.MANAGER);
        List<Dto.AccountView> out = new ArrayList<>();
        for (Account a : accounts.findByRoleAndActiveTrue(Role.TECHNICIAN)) out.add(Views.account(a));
        return out;
    }

    @GetMapping("/tenants")
    public List<Dto.AccountView> tenants() {
        Account who = currentUser.require();
        currentUser.requireRole(who, Role.MANAGER);
        List<Dto.AccountView> out = new ArrayList<>();
        for (Account a : accounts.findByRoleAndActiveTrue(Role.TENANT)) out.add(Views.account(a));
        return out;
    }

    @PostMapping("/expenses/{expenseId}/approve")
    public Dto.ExpenseView approve(@PathVariable Long expenseId) {
        return requests.approveExpense(currentUser.require(), expenseId);
    }
}
