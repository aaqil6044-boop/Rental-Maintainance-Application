package com.pmp.app;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/maintenance-requests")
public class RequestController {

    private final RequestService service;
    private final CurrentUser currentUser;

    public RequestController(RequestService service, CurrentUser currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<Dto.RequestView> list(@RequestParam(required = false) RequestStatus status) {
        return service.list(currentUser.require(), status);
    }

    @PostMapping
    public ResponseEntity<Dto.RequestView> create(@Valid @RequestBody Dto.CreateRequestRequest req) {
        Dto.RequestView created = service.create(currentUser.require(), req);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping("/{id}")
    public Dto.RequestDetailView detail(@PathVariable Long id) {
        return service.detail(currentUser.require(), id);
    }

    @PostMapping("/{id}/status")
    public Dto.RequestView transition(@PathVariable Long id,
                                      @Valid @RequestBody Dto.TransitionRequest req) {
        return service.transition(currentUser.require(), id, req);
    }

    @PostMapping("/{id}/assign")
    public Dto.RequestView assign(@PathVariable Long id, @Valid @RequestBody Dto.AssignRequest req) {
        return service.assign(currentUser.require(), id, req);
    }

    @PostMapping("/{id}/comments")
    public ResponseEntity<Dto.CommentView> comment(@PathVariable Long id,
                                                   @Valid @RequestBody Dto.CommentRequest req) {
        Dto.CommentView created = service.addComment(currentUser.require(), id, req);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PostMapping("/{id}/expenses")
    public ResponseEntity<Dto.ExpenseView> expense(@PathVariable Long id,
                                                   @Valid @RequestBody Dto.ExpenseRequest req) {
        Dto.ExpenseView created = service.addExpense(currentUser.require(), id, req);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }
}
